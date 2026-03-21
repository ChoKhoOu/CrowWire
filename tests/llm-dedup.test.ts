import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { initLlmDedupSchema, cacheLlmDedupResult, getLlmDedupResult } from '../src/lib/llm-dedup-db.js'
import { llmDedup } from '../src/lib/llm-dedup.js'
import type { FeedItem } from '../src/types.js'
import type { LlmClient } from '../src/lib/llm-client.js'

function makeItem(overrides: Partial<FeedItem> & { id: string; title: string; content: string }): FeedItem {
  return {
    link: `https://example.com/${overrides.id}`,
    published_at: '2026-01-01T00:00:00Z',
    source: 'test',
    content_hash: overrides.content_hash ?? overrides.id,
    ...overrides,
  }
}

function makeMockClient(result: { same: boolean; reason: string } | Error): LlmClient {
  return {
    chatCompletionJson: result instanceof Error
      ? vi.fn().mockRejectedValue(result)
      : vi.fn().mockResolvedValue(result),
    chatCompletion: vi.fn(),
  } as unknown as LlmClient
}

describe('llmDedup', () => {
  let dbPath: string
  let db: Database.Database

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'crowwire-llm-dedup-'))
    dbPath = join(dir, 'test.db')
    db = new Database(dbPath)
    initLlmDedupSchema(db)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    db.close()
    try { unlinkSync(dbPath) } catch {}
    vi.restoreAllMocks()
  })

  // 1. Clearly unique items — low similarity, no LLM call needed, all items pass through
  it('passes through clearly unique items without calling LLM', async () => {
    const client = makeMockClient({ same: false, reason: 'different' })
    const candidates = [
      makeItem({ id: 'a', title: 'Quantum computing breakthrough', content: 'Scientists achieve new milestone in quantum computing with error correction.' }),
    ]
    const recentItems = [
      { title: 'Football match results', content: 'The home team won 3-0 in last night championship game.' },
    ]

    const result = await llmDedup(candidates, recentItems, client, db)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
    expect((client.chatCompletionJson as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  // 2. Clear duplicates — similarity above threshold, items filtered without LLM
  it('filters clear duplicates above threshold without calling LLM', async () => {
    const client = makeMockClient({ same: false, reason: 'different' })
    const title = '央行宣布降息50个基点以刺激经济增长'
    const content = '中国人民银行今日宣布将基准利率下调50个基点，这是今年第三次降息，旨在刺激经济增长并应对通货紧缩压力。'
    const candidates = [
      makeItem({ id: 'dup', title, content }),
    ]
    const recentItems = [
      { title, content },
    ]

    const result = await llmDedup(candidates, recentItems, client, db)

    expect(result).toHaveLength(0)
    expect((client.chatCompletionJson as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  // 3. Ambiguous zone triggers LLM — similarity between 0.3 and threshold
  // US Fed pair yields sim ~0.36, safely in [0.3, 0.55)
  it('calls LLM for ambiguous zone items', async () => {
    const client = makeMockClient({ same: false, reason: 'different events' })
    const candidates = [
      makeItem({
        id: 'amb',
        title: '美联储加息决策',
        content: '美联储宣布加息25个基点，市场反应平稳，分析师预计年内还有两次加息。',
      }),
    ]
    const recentItems = [
      {
        title: '美联储利率政策',
        content: '美联储货币政策委员会投票决定上调基准利率，通胀数据支持继续收紧。',
      },
    ]

    await llmDedup(candidates, recentItems, client, db, 0.55)

    expect((client.chatCompletionJson as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
  })

  // 4. LLM says same → item deduped
  it('removes item when LLM says same=true', async () => {
    const client = makeMockClient({ same: true, reason: 'same event' })
    const candidates = [
      makeItem({
        id: 'item1',
        title: '美联储加息决策',
        content: '美联储宣布加息25个基点，市场反应平稳，分析师预计年内还有两次加息。',
      }),
    ]
    const recentItems = [
      {
        title: '美联储利率政策',
        content: '美联储货币政策委员会投票决定上调基准利率，通胀数据支持继续收紧。',
      },
    ]

    const result = await llmDedup(candidates, recentItems, client, db, 0.55)

    expect(result.find(r => r.id === 'item1')).toBeUndefined()
  })

  // 5. LLM says different → item kept
  it('keeps item when LLM says same=false', async () => {
    const client = makeMockClient({ same: false, reason: 'different events' })
    const candidates = [
      makeItem({
        id: 'item2',
        title: '美联储加息决策',
        content: '美联储宣布加息25个基点，市场反应平稳，分析师预计年内还有两次加息。',
      }),
    ]
    const recentItems = [
      {
        title: '美联储利率政策',
        content: '美联储货币政策委员会投票决定上调基准利率，通胀数据支持继续收紧。',
      },
    ]

    const result = await llmDedup(candidates, recentItems, client, db, 0.55)

    expect(result.find(r => r.id === 'item2')).toBeDefined()
  })

  // 6. Cache hit skips LLM call
  // US Fed pair yields sim ~0.36, in ambiguous zone — but we pre-populate cache so LLM is skipped
  it('skips LLM call when cache already has result', async () => {
    const client = makeMockClient({ same: true, reason: 'same' })
    const candidateContentHash = 'hash-item3'
    const matchIndex = 0

    // Pre-populate cache with isSame=false
    // pairHash sorts [candidateContentHash, `recent_${matchIndex}`] then sha256 first 16 chars
    const { createHash } = await import('crypto')
    const sorted = [candidateContentHash, `recent_${matchIndex}`].sort()
    const hash = createHash('sha256').update(sorted.join('||')).digest('hex').slice(0, 16)
    cacheLlmDedupResult(db, hash, false)

    const candidates = [
      makeItem({
        id: 'item3',
        title: '美联储加息决策',
        content: '美联储宣布加息25个基点，市场反应平稳，分析师预计年内还有两次加息。',
        content_hash: candidateContentHash,
      }),
    ]
    const recentItems = [
      {
        title: '美联储利率政策',
        content: '美联储货币政策委员会投票决定上调基准利率，通胀数据支持继续收紧。',
      },
    ]

    await llmDedup(candidates, recentItems, client, db, 0.55)

    expect((client.chatCompletionJson as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  // 7. Cache miss calls LLM and stores result
  it('calls LLM on cache miss and stores result in cache', async () => {
    const client = makeMockClient({ same: true, reason: 'same event' })
    const candidateContentHash = 'hash-item4'
    const matchIndex = 0

    const candidates = [
      makeItem({
        id: 'item4',
        title: '美联储加息决策',
        content: '美联储宣布加息25个基点，市场反应平稳，分析师预计年内还有两次加息。',
        content_hash: candidateContentHash,
      }),
    ]
    const recentItems = [
      {
        title: '美联储利率政策',
        content: '美联储货币政策委员会投票决定上调基准利率，通胀数据支持继续收紧。',
      },
    ]

    await llmDedup(candidates, recentItems, client, db, 0.55)

    expect((client.chatCompletionJson as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()

    // Verify result was cached
    const { createHash } = await import('crypto')
    const sorted = [candidateContentHash, `recent_${matchIndex}`].sort()
    const hash = createHash('sha256').update(sorted.join('||')).digest('hex').slice(0, 16)
    expect(getLlmDedupResult(db, hash)).toBe(true)
  })

  // 8. LLM failure → fail-safe keeps item
  it('keeps item when LLM call throws (fail-safe)', async () => {
    const client = makeMockClient(new Error('LLM unavailable'))
    const candidates = [
      makeItem({
        id: 'item5',
        title: '美联储加息决策',
        content: '美联储宣布加息25个基点，市场反应平稳，分析师预计年内还有两次加息。',
      }),
    ]
    const recentItems = [
      {
        title: '美联储利率政策',
        content: '美联储货币政策委员会投票决定上调基准利率，通胀数据支持继续收紧。',
      },
    ]

    const result = await llmDedup(candidates, recentItems, client, db, 0.55)

    expect(result.find(r => r.id === 'item5')).toBeDefined()
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('[llm-dedup] LLM call failed')
    )
  })

  // 9. Chunking works for >5 pairs — create >5 ambiguous pairs, verify all processed
  // US Fed variant candidates yield sim ~0.3064 vs the recent item: safely in [0.3, 0.55)
  it('processes more than BATCH_SIZE ambiguous pairs without silent dropping', async () => {
    const recentItems = [
      {
        title: '美联储利率政策决议',
        content: '美联储货币政策委员会投票决定上调基准利率25个基点，通胀数据支持继续收紧货币政策。',
      },
    ]

    const candidates = Array.from({ length: 7 }, (_, i) =>
      makeItem({
        id: `chunk-item-${i}`,
        title: `美联储加息决策分析${i}`,
        content: `美联储宣布加息25个基点，市场反应平稳，分析师预计年内还有两次加息。报道编号${i}。`,
        content_hash: `hash-chunk-${i}`,
      })
    )

    // LLM says different for all → all kept
    const client = makeMockClient({ same: false, reason: 'different' })

    const result = await llmDedup(candidates, recentItems, client, db, 0.55)

    // All 7 should be kept (LLM said different)
    expect(result).toHaveLength(7)
    // LLM should have been called for each unique candidate (7 calls across 2 chunks)
    expect((client.chatCompletionJson as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(7)
  })

  // Edge case: empty recentItems returns all candidates unchanged
  it('returns all candidates when recentItems is empty', async () => {
    const client = makeMockClient({ same: false, reason: 'n/a' })
    const candidates = [
      makeItem({ id: 'x', title: 'Some title', content: 'Some content' }),
    ]

    const result = await llmDedup(candidates, [], client, db)

    expect(result).toHaveLength(1)
    expect((client.chatCompletionJson as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
})
