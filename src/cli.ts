#!/usr/bin/env node
import { Command } from 'commander';
import { runFetch } from './commands/fetch.js';
import { runDedup } from './commands/dedup.js';
import { runScore } from './commands/score.js';
import { runClassify } from './commands/classify.js';
import { runFormat } from './commands/format.js';

const program = new Command();

program
  .name('crowwire-cli')
  .description('CrowWire news monitoring CLI for OpenClaw Lobster workflows')
  .version('1.0.0');

program
  .command('fetch')
  .description('Fetch RSS feeds and output normalized items as JSON')
  .requiredOption('--config <path>', 'Path to feeds.yaml configuration file')
  .option('--max-items <n>', 'Maximum number of items to output', parseInt)
  .action(async (opts: { config: string; maxItems?: number }) => {
    try {
      await runFetch(opts.config, opts.maxItems);
    } catch (err) {
      process.stderr.write(`[error] fetch: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('dedup')
  .description('Read items from stdin, filter duplicates via SQLite')
  .requiredOption('--db <path>', 'Path to SQLite database file')
  .option('--ttl <hours>', 'Dedup TTL in hours', parseInt, 72)
  .action(async (opts: { db: string; ttl: number }) => {
    try {
      await runDedup(opts.db, opts.ttl);
    } catch (err) {
      process.stderr.write(`[error] dedup: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('score')
  .description('Read items from stdin, score via LLM (openclaw.invoke llm-task)')
  .action(async () => {
    try {
      await runScore();
    } catch (err) {
      process.stderr.write(`[error] score: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('classify')
  .description('Read scored items from stdin, classify urgent/normal, manage buffer')
  .requiredOption('--db <path>', 'Path to SQLite database file')
  .option('--threshold <n>', 'Urgency threshold for breaking news', parseInt, 85)
  .option('--digest-interval <min>', 'Digest flush interval in minutes', parseInt, 15)
  .option('--similarity-threshold <n>', 'Similarity threshold for cross-source aggregation', parseFloat, 0.55)
  .option('--sent-event-ttl <hours>', 'TTL in hours for sent urgent event records', parseInt, 24)
  .action(async (opts: { db: string; threshold: number; digestInterval: number; similarityThreshold: number; sentEventTtl: number }) => {
    try {
      await runClassify(opts.db, opts.threshold, opts.digestInterval, opts.similarityThreshold, opts.sentEventTtl);
    } catch (err) {
      process.stderr.write(`[error] classify: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('format')
  .description('Read ClassifyOutput from stdin, output formatted message')
  .requiredOption('--type <type>', 'Message type: "urgent" or "digest"')
  .action(async (opts: { type: string }) => {
    const type = opts.type as string;
    if (type !== 'urgent' && type !== 'digest') {
      process.stderr.write(`[error] format: --type must be "urgent" or "digest"\n`);
      process.exit(1);
    }
    try {
      await runFormat(type);
    } catch (err) {
      process.stderr.write(`[error] format: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program.parse();
