import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { loadEnv } from './config/env.js';
import { logger } from './shared/logger.js';
import { QUEUE_NAMES } from './config/constants.js';
import { healthRoutes } from './api/routes/health.js';
import { metricsRoute } from './api/routes/metrics.js';
import { errorHandler } from './api/plugins/error-handler.js';
import { setupFeedSchedulers, removeFeedSchedulers } from './queue/scheduler.js';
import { registerWorker, pauseAllWorkers, closeAllWorkers } from './queue/workers.js';
import { getQueues, closeQueues } from './queue/queues.js';
import { closeRedis } from './queue/connection.js';
import { closeDb, getPool } from './db/client.js';
import { DEFAULTS } from './config/constants.js';
import { processIngestJob } from './pipeline/ingestor/ingestor.js';
import { processScoreJob } from './pipeline/scorer/scorer.js';
import { processUrgentFlush } from './pipeline/aggregator/urgent-flusher.js';
import { processBatchFlush } from './pipeline/aggregator/batch-flusher.js';
import { OpenClawBridge } from './pipeline/bridge/openclaw-bridge.js';
import { queueDepth, dlqDepth } from './shared/metrics.js';
import type { DeliveryPayload } from './types/delivery.js';

async function main() {
  const env = loadEnv();
  logger.info({ nodeEnv: env.NODE_ENV }, 'Starting CrowWire');

  // Verify database schema exists
  try {
    const pool = getPool();
    const client = await pool.connect();
    await client.query('SELECT 1 FROM events LIMIT 0');
    client.release();
    logger.info('Database schema verified');
  } catch (err) {
    logger.fatal({ err }, 'Database schema not found. Run "npm run db:push" to create tables.');
    process.exit(1);
  }

  // Initialize Fastify
  const app = Fastify({ logger: false });

  // Register plugins and routes
  await app.register(helmet);
  await app.register(cors, { origin: false });
  await app.register(errorHandler);
  await app.register(healthRoutes);
  await app.register(metricsRoute);

  // Start HTTP server
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'HTTP server listening');

  // Register BullMQ workers
  registerWorker(QUEUE_NAMES.INGEST, processIngestJob, {
    concurrency: env.INGEST_CONCURRENCY,
  });
  logger.info({ concurrency: env.INGEST_CONCURRENCY }, 'Ingest worker registered');

  registerWorker(QUEUE_NAMES.SCORE, processScoreJob, {
    concurrency: env.SCORER_CONCURRENCY,
    limiter: { max: 10, duration: 1000 },
  });
  logger.info({ concurrency: env.SCORER_CONCURRENCY }, 'Score worker registered');

  // Aggregation worker: handles both urgent and batch flush jobs
  registerWorker(QUEUE_NAMES.AGGREGATE, async (job) => {
    const { bundleType } = job.data;
    if (bundleType === 'urgent') {
      await processUrgentFlush(job);
    } else {
      await processBatchFlush(job);
    }
  }, { concurrency: 1 }); // CORRECTNESS INVARIANT: must be 1
  logger.info('Aggregate worker registered (concurrency: 1)');

  // Delivery worker
  const bridge = new OpenClawBridge();
  registerWorker(QUEUE_NAMES.DELIVER, async (job) => {
    const { payload } = job.data as { payload: DeliveryPayload };
    await bridge.deliver(payload, job.attemptsMade + 1);
  }, { concurrency: env.DELIVER_CONCURRENCY });
  logger.info({ concurrency: env.DELIVER_CONCURRENCY }, 'Deliver worker registered');

  // Setup feed schedulers
  await setupFeedSchedulers();
  logger.info('Feed schedulers initialized');

  // Setup aggregation flush schedulers
  const { aggregate } = getQueues();
  await aggregate.upsertJobScheduler('urgent-flush', {
    every: env.URGENT_FLUSH_INTERVAL_MS,
  }, {
    name: 'flush:urgent',
    data: { bundleType: 'urgent' },
  });
  await aggregate.upsertJobScheduler('batch-flush', {
    every: env.BATCH_FLUSH_INTERVAL_MS,
  }, {
    name: 'flush:batch',
    data: { bundleType: 'batch' },
  });
  logger.info({
    urgentInterval: env.URGENT_FLUSH_INTERVAL_MS,
    batchInterval: env.BATCH_FLUSH_INTERVAL_MS,
  }, 'Aggregation flush schedulers initialized');

  // DLQ depth monitoring (runs every 60s)
  const dlqMonitorInterval = setInterval(async () => {
    try {
      const queues = getQueues();
      for (const [name, queue] of Object.entries(queues)) {
        const waiting = await queue.getWaitingCount();
        const failed = await queue.getFailedCount();
        queueDepth.set({ queue_name: name }, waiting);
        dlqDepth.set({ queue_name: name }, failed);
        if (failed > 0) {
          logger.warn({ queue: name, depth: failed }, 'DLQ depth > 0');
        }
      }
    } catch (err) {
      logger.error({ err }, 'DLQ monitor error');
    }
  }, 60000);

  // Graceful shutdown
  let isShuttingDown = false;

  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');

    clearInterval(dlqMonitorInterval);
    await app.close();
    logger.info('HTTP server closed');

    await removeFeedSchedulers();
    logger.info('Feed schedulers removed');

    await pauseAllWorkers();
    logger.info('Workers paused');

    await new Promise(resolve => setTimeout(resolve, 2000));

    await closeAllWorkers();
    logger.info('Workers closed');

    await closeQueues();
    logger.info('Queues closed');

    await closeRedis();
    logger.info('Redis closed');

    await closeDb();
    logger.info('Postgres closed');

    logger.info('Graceful shutdown complete');
    process.exit(0);
  }

  function shutdownWithTimeout(signal: string) {
    shutdown(signal).catch((err) => {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    });
    setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, DEFAULTS.GRACEFUL_SHUTDOWN_TIMEOUT_MS);
  }

  process.on('SIGTERM', () => shutdownWithTimeout('SIGTERM'));
  process.on('SIGINT', () => shutdownWithTimeout('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdownWithTimeout('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    shutdownWithTimeout('unhandledRejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start CrowWire');
  process.exit(1);
});
