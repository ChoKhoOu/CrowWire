import type { FastifyInstance } from 'fastify';
import { checkDbConnection } from '../../db/client.js';
import { checkRedisConnection } from '../../queue/connection.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  fastify.get('/ready', async (_request, reply) => {
    const checks = {
      postgres: await checkDbConnection(),
      redis: await checkRedisConnection(),
    };

    const allHealthy = Object.values(checks).every(Boolean);

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
}
