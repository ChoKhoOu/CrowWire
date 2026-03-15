import { Redis } from 'ioredis';
import { getConfig } from '../config/config.js';
import { logger } from '../shared/logger.js';

let _connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!_connection) {
    const config = getConfig();
    _connection = new Redis(config.redis.url, {
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

export function createRedisConnection(): Redis {
  const config = getConfig();
  return new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times: number) {
      return Math.min(times * 200, 5000);
    },
  });
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
