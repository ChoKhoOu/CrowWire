import type { FastifyInstance } from 'fastify';
import { registry } from '../../shared/metrics.js';

export async function metricsRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/metrics', async (_request, reply) => {
    const metrics = await registry.metrics();
    return reply
      .header('Content-Type', registry.contentType)
      .send(metrics);
  });
}
