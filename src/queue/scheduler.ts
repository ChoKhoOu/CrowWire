import { getQueues } from './queues.js';
import { getConfig } from '../config/config.js';
import { logger } from '../shared/logger.js';

export async function setupFeedSchedulers(): Promise<void> {
  const config = getConfig();
  const feeds = config.feeds.sources.filter(f => f.enabled);
  const { ingest } = getQueues();

  for (const feed of feeds) {
    await ingest.upsertJobScheduler(
      `feed:${feed.name}`,
      { every: feed.poll_interval_ms },
      {
        name: `ingest:${feed.name}`,
        data: { feedName: feed.name, feedConfig: feed },
      }
    );
    logger.info({ feed: feed.name, interval: feed.poll_interval_ms }, 'Feed scheduler registered');
  }

  logger.info({ count: feeds.length }, 'All feed schedulers registered');
}

export async function removeFeedSchedulers(): Promise<void> {
  const { ingest } = getQueues();
  const schedulers = await ingest.getJobSchedulers();
  for (const scheduler of schedulers) {
    if (scheduler.id) {
      await ingest.removeJobScheduler(scheduler.id);
    }
  }
  logger.info('All feed schedulers removed');
}
