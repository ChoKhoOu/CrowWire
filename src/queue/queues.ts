import { Queue } from 'bullmq';
import { createRedisConnection } from './connection.js';
import { QUEUE_NAMES } from '../config/constants.js';

let _queues: Record<string, Queue> | null = null;

export function getQueues() {
  if (!_queues) {
    const connection = createRedisConnection();
    _queues = {
      ingest: new Queue(QUEUE_NAMES.INGEST, { connection }),
      score: new Queue(QUEUE_NAMES.SCORE, { connection }),
      aggregate: new Queue(QUEUE_NAMES.AGGREGATE, { connection }),
      deliver: new Queue(QUEUE_NAMES.DELIVER, { connection }),
    };
  }
  return _queues;
}

export async function closeQueues(): Promise<void> {
  if (_queues) {
    await Promise.all(Object.values(_queues).map(q => q.close()));
    _queues = null;
  }
}

export async function checkQueuesReady(): Promise<boolean> {
  try {
    const queues = getQueues();
    // Verify queues are connected by checking the underlying client
    await Promise.all(Object.values(queues).map(q => q.waitUntilReady()));
    return true;
  } catch {
    return false;
  }
}
