import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../shared/logger.js';

export async function errorHandler(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
      logger.error({ err: error, url: request.url, method: request.method }, 'Server error');
    } else {
      logger.warn({ err: error, url: request.url, method: request.method }, 'Client error');
    }

    const response: Record<string, unknown> = {
      error: error.name || 'InternalServerError',
      message: statusCode >= 500 && process.env.NODE_ENV === 'production'
        ? 'Internal Server Error'
        : error.message,
      statusCode,
    };

    return reply.status(statusCode).send(response);
  });
}
