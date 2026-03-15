import { pgTable, uuid, varchar, text, integer, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const events = pgTable('events', {
  id: uuid('id').primaryKey(),
  source_type: varchar('source_type', { length: 10 }).notNull(),
  source_name: varchar('source_name', { length: 255 }).notNull(),
  source_route: varchar('source_route', { length: 500 }).notNull(),
  guid: varchar('guid', { length: 500 }),
  canonical_url: text('canonical_url').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  content: text('content'),
  published_at: timestamp('published_at', { withTimezone: true }).notNull(),
  ingested_at: timestamp('ingested_at', { withTimezone: true }).notNull(),
  identity_hash: varchar('identity_hash', { length: 64 }).notNull(),
  content_hash: varchar('content_hash', { length: 64 }).notNull(),
  tags: text('tags').array().notNull(),
  // Scoring fields (filled after scoring)
  urgency_score: integer('urgency_score'),
  relevance_score: integer('relevance_score'),
  novelty_score: integer('novelty_score'),
  category_tags: text('category_tags').array(),
  score_reason: text('score_reason'),
  routing: varchar('routing', { length: 10 }),
  scored_at: timestamp('scored_at', { withTimezone: true }),
}, (table) => [
  index('idx_events_source').on(table.source_name),
  index('idx_events_ingested').on(table.ingested_at),
  index('idx_events_routing').on(table.routing),
]);

export const dedupIndex = pgTable('dedup_index', {
  id: uuid('id').primaryKey(),
  hash_value: varchar('hash_value', { length: 64 }).notNull(),
  hash_type: varchar('hash_type', { length: 30 }).notNull(),
  event_id: uuid('event_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_dedup_hash').on(table.hash_value),
  index('idx_dedup_created').on(table.created_at),
]);

export const deliveryLog = pgTable('delivery_log', {
  id: uuid('id').primaryKey(),
  bundle_id: uuid('bundle_id').notNull(),
  bundle_type: varchar('bundle_type', { length: 10 }),
  event_count: integer('event_count'),
  attempt_number: integer('attempt_number'),
  status_code: integer('status_code'),
  success: boolean('success'),
  error_message: text('error_message'),
  duration_ms: integer('duration_ms'),
  idempotency_key: varchar('idempotency_key', { length: 64 }),
  target_name: varchar('target_name', { length: 100 }).notNull().default('openclaw'),
  attempted_at: timestamp('attempted_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_delivery_bundle').on(table.bundle_id),
  index('idx_delivery_attempted').on(table.attempted_at),
  index('idx_delivery_idempotency_target').on(table.idempotency_key, table.target_name),
]);
