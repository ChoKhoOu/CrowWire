import { getDb, closeDb, isSeenItem, markSeen, cleanupExpired, getRecentSentEvents, recordSentEvent, cleanupExpiredSentEvents } from './lib/db.js';
import { loadConfig } from './lib/config.js';
import { loadTargets, loadDaemonConfig } from './lib/target-config.js';
import { createLlmClient } from './lib/llm-client.js';
import type { LlmClient } from './lib/llm-client.js';
import { createPushTargets, getTargetsForQueue } from './lib/push-target.js';
import type { PushTarget } from './lib/push-target.js';
import { QueueManager } from './lib/queue.js';
import type { QueueItem } from './lib/queue.js';
import { initQueueSchema } from './lib/queue-db.js';
import { initLlmDedupSchema, cleanupLlmDedupCache } from './lib/llm-dedup-db.js';
import { llmDedup } from './lib/llm-dedup.js';
import { scoreBatch } from './lib/llm.js';
import { fetchAllFeeds } from './lib/rss.js';
import { groupByEvent } from './lib/aggregator.js';
import { formatUrgent, formatDigestGrouped } from './lib/formatter.js';
import { computePairwiseSimilarity } from './lib/similarity.js';
import type { FeedsConfig, DaemonConfig, ScoredItem, FeedItem } from './types.js';
import type Database from 'better-sqlite3';

class CrowWireDaemon {
  private db!: Database.Database;
  private feedsConfig!: FeedsConfig;
  private daemonConfig!: DaemonConfig;
  private queueManager!: QueueManager;
  private pushTargets!: PushTarget[];
  private llmClient!: LlmClient;
  private fetchTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopped = false;
  private stats = { itemsProcessed: 0, messagesSent: 0, pipelineRuns: 0, llmCalls: 0 };

  async start(): Promise<void> {
    // 1. Load configs
    this.daemonConfig = loadDaemonConfig();
    this.feedsConfig = loadConfig(this.daemonConfig.feeds_config);
    const targetsConfig = loadTargets(this.daemonConfig.targets_config);

    // 2. Init DB — getDb() handles base schema initialization
    this.db = getDb(this.daemonConfig.db_path);
    initQueueSchema(this.db);
    initLlmDedupSchema(this.db);

    // 3. Init LLM client
    this.llmClient = createLlmClient();

    // 4. Init push targets
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) throw new Error('Missing DISCORD_BOT_TOKEN env var');
    this.pushTargets = createPushTargets(targetsConfig, botToken);

    // 5. Init queue manager with DB persistence
    this.queueManager = new QueueManager(
      this.daemonConfig.urgent_flush_interval,
      this.daemonConfig.urgent_flush_count,
      this.daemonConfig.digest_flush_interval,
    );
    this.queueManager.setDb(this.db);
    this.queueManager.recover(this.db);

    // 6. Start queue flush handlers
    this.queueManager.start(
      (items) => this.handleUrgentFlush(items),
      (items) => this.handleNormalFlush(items),
    );

    // 7. Log startup info
    process.stderr.write(`[daemon] CrowWire daemon started\n`);
    process.stderr.write(`[daemon] Feeds: ${this.feedsConfig.feeds.filter(f => f.enabled !== false).length}, Targets: ${this.pushTargets.length}\n`);
    process.stderr.write(`[daemon] Fetch interval: ${this.daemonConfig.fetch_interval}ms, Urgent flush: ${this.daemonConfig.urgent_flush_interval}ms/${this.daemonConfig.urgent_flush_count} items, Digest flush: ${this.daemonConfig.digest_flush_interval}ms\n`);

    // 8. Start pipeline with first run, then chained setTimeout
    await this.runPipeline();
    this.scheduleNextRun();

    // 9. Start health logging
    this.startHealthLog();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    // Stop timers
    if (this.fetchTimer) {
      clearTimeout(this.fetchTimer);
      this.fetchTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    // Stop queues (flushes pending items)
    this.queueManager.stop();

    // Destroy push targets
    for (const target of this.pushTargets) {
      await target.destroy();
    }

    // Close DB
    closeDb();

    process.stderr.write(`[daemon] Shutdown complete. Stats: ${JSON.stringify(this.stats)}\n`);
  }

  private scheduleNextRun(): void {
    if (this.stopped) return;
    this.fetchTimer = setTimeout(() => {
      this.runPipeline()
        .catch(err => process.stderr.write(`[daemon] Pipeline error: ${(err as Error).message}\n`))
        .finally(() => this.scheduleNextRun());
    }, this.daemonConfig.fetch_interval);
  }

  private async runPipeline(): Promise<void> {
    if (this.running) {
      process.stderr.write('[daemon] Pipeline already running, skipping\n');
      return;
    }
    this.running = true;
    this.stats.pipelineRuns++;

    try {
      // 1. Fetch RSS
      const feeds = this.feedsConfig.feeds.filter(f => f.enabled !== false);
      const allItems = await fetchAllFeeds(
        feeds,
        this.daemonConfig.content_max_chars,
        this.daemonConfig.max_items_per_run,
      );
      if (allItems.length === 0) {
        this.running = false;
        return;
      }

      // 2. Dedup (hash-based)
      const newItems: FeedItem[] = [];
      for (const item of allItems) {
        if (!isSeenItem(this.db, item.content_hash || item.id, item.content_hash)) {
          markSeen(this.db, item.content_hash || item.id, item.content_hash);
          newItems.push(item);
        }
      }
      if (newItems.length === 0) {
        this.running = false;
        return;
      }

      // 3. Score via LLM
      const scored = await scoreBatch(newItems);

      // 4. LLM-assisted dedup
      const recentSent = getRecentSentEvents(this.db, this.daemonConfig.sent_event_ttl_hours);
      const dedupedItems = await llmDedup(
        scored,
        recentSent.map(e => ({ title: e.title, content: e.content })),
        this.llmClient,
        this.db,
        this.daemonConfig.similarity_threshold,
      );

      // 5. Classify and dispatch to queues
      for (const item of dedupedItems as ScoredItem[]) {
        if (item.urgency >= this.daemonConfig.urgency_threshold) {
          // Check similarity against recently sent urgent events
          let isDuplicate = false;
          for (const recent of recentSent) {
            const sim = computePairwiseSimilarity(
              { title: item.title, content: item.content },
              { title: recent.title, content: recent.content },
            );
            if (sim >= this.daemonConfig.similarity_threshold) {
              isDuplicate = true;
              break;
            }
          }
          if (!isDuplicate) {
            this.queueManager.dispatch(item, this.daemonConfig.urgency_threshold);
            recordSentEvent(this.db, item.title, item.content || '');
          }
        } else {
          this.queueManager.dispatch(item, this.daemonConfig.urgency_threshold);
        }
      }

      this.stats.itemsProcessed += dedupedItems.length;

      // 6. Cleanup expired data
      cleanupExpired(this.db, this.daemonConfig.dedup_ttl_hours);
      cleanupExpiredSentEvents(this.db, this.daemonConfig.sent_event_ttl_hours);
      cleanupLlmDedupCache(this.db, this.daemonConfig.dedup_ttl_hours);

      if (dedupedItems.length > 0) {
        process.stderr.write(`[daemon] Pipeline: ${allItems.length} fetched, ${newItems.length} new, ${dedupedItems.length} after dedup\n`);
      }
    } catch (err) {
      process.stderr.write(`[daemon] Pipeline error: ${(err as Error).message}\n`);
    } finally {
      this.running = false;
    }
  }

  private async handleUrgentFlush(items: QueueItem[]): Promise<void> {
    if (items.length === 0) return;
    try {
      const scoredItems = items.map(i => i.message as ScoredItem);
      const formatted = formatUrgent(scoredItems);
      if (!formatted) return;

      const targets = getTargetsForQueue(this.pushTargets, 'urgent');
      for (const target of targets) {
        await target.send(formatted);
        this.stats.messagesSent++;
      }

      process.stderr.write(`[daemon] Sent ${items.length} urgent items to ${targets.length} targets\n`);
    } catch (err) {
      process.stderr.write(`[daemon] Urgent flush error: ${(err as Error).message}\n`);
      throw err;
    }
  }

  private async handleNormalFlush(items: QueueItem[]): Promise<void> {
    if (items.length === 0) return;
    try {
      const scoredItems = items.map(i => i.message as ScoredItem);

      // Group by similarity
      const groups = groupByEvent(scoredItems, this.daemonConfig.similarity_threshold);

      // Generate merge summaries for multi-source groups
      for (const group of groups) {
        if (group.isMultiSource && group.members.length > 1) {
          try {
            const sources = [...new Set(group.members.map(m => m.source))];
            const titles = group.members.map(m => m.title);
            const snippets = group.members.map(m => (m.summary || m.content || m.title).slice(0, 100));

            const prompt = `你是一个新闻摘要助手。用2-3句话简洁总结以下来自多个来源的相关新闻报道。`;
            const userMsg = `来源: ${sources.join(', ')}\n标题:\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n摘要:\n${snippets.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

            const summary = await this.llmClient.chatCompletion(prompt, userMsg);
            group.mergedSummary = summary.trim();
          } catch {
            // Degradation: no merged summary
          }
        }
      }

      const formatted = formatDigestGrouped(groups);
      if (!formatted) return;

      const targets = getTargetsForQueue(this.pushTargets, 'normal');
      for (const target of targets) {
        await target.send(formatted);
        this.stats.messagesSent++;
      }

      process.stderr.write(`[daemon] Sent digest (${items.length} items, ${groups.length} groups) to ${targets.length} targets\n`);
    } catch (err) {
      process.stderr.write(`[daemon] Digest flush error: ${(err as Error).message}\n`);
      throw err;
    }
  }

  private startHealthLog(): void {
    this.healthTimer = setInterval(() => {
      if (this.stopped) return;
      process.stderr.write(`[daemon] Health: ${JSON.stringify(this.stats)}, Urgent queue: ${this.queueManager.urgent.size()}, Normal queue: ${this.queueManager.normal.size()}\n`);
    }, 300_000);
  }
}

export { CrowWireDaemon };

// Main entry when run directly
const daemon = new CrowWireDaemon();

process.on('SIGINT', async () => {
  process.stderr.write('[daemon] Received SIGINT, shutting down...\n');
  await daemon.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  process.stderr.write('[daemon] Received SIGTERM, shutting down...\n');
  await daemon.stop();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`[daemon] Uncaught exception: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[daemon] Unhandled rejection: ${reason}\n`);
});

daemon.start().catch(err => {
  process.stderr.write(`[daemon] Failed to start: ${(err as Error).message}\n`);
  process.exit(1);
});
