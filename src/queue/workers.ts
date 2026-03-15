import { Worker } from 'bullmq';
import { getRedisConnection } from './connection.js';
import { QUEUE_NAMES } from '../config/constants.js';
import { getEnv } from '../config/env.js';
import { logger } from '../shared/logger.js';

const workers: Worker[] = [];

export function registerWorker(
  queueName: string,
  processor: (job: any) => Promise<any>,
  opts?: { concurrency?: number; limiter?: { max: number; duration: number } }
): Worker {
  const connection = getRedisConnection();
  const worker = new Worker(queueName, processor, {
    connection,
    concurrency: opts?.concurrency,
    limiter: opts?.limiter,
  });

  worker.on('completed', (job) => {
    logger.debug({ jobId: job?.id, queue: queueName }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, queue: queueName, err }, 'Job failed');
  });

  worker.on('error', (err) => {
    logger.error({ queue: queueName, err }, 'Worker error');
  });

  workers.push(worker);
  return worker;
}

export async function pauseAllWorkers(): Promise<void> {
  await Promise.all(workers.map(w => w.pause()));
  logger.info('All workers paused');
}

export async function closeAllWorkers(): Promise<void> {
  await Promise.all(workers.map(w => w.close()));
  workers.length = 0;
  logger.info('All workers closed');
}
