import { Redis } from 'ioredis';
import { getEnv } from '../config/env.js';
import { logger } from '../shared/logger.js';

let _connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!_connection) {
    const env = getEnv();
    _connection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: true,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
    });
    _connection.on('error', (err: Error) => {
      logger.error({ err }, 'Redis connection error');
    });
    _connection.on('connect', () => {
      logger.info('Redis connected');
    });
  }
  return _connection;
}

export async function closeRedis(): Promise<void> {
  if (_connection) {
    await _connection.quit();
    _connection = null;
  }
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    const conn = getRedisConnection();
    const result = await conn.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
