import { createHash } from 'crypto'
import type Database from 'better-sqlite3'
import type { FeedItem } from '../types.js'
import type { LlmClient } from './llm-client.js'
import { computePairwiseSimilarity } from './similarity.js'
import { getLlmDedupResult, cacheLlmDedupResult } from './llm-dedup-db.js'

const AMBIGUOUS_LOW = 0.3
const BATCH_SIZE = 5

interface DedupPair {
  candidate: FeedItem
  matchIndex: number
  similarity: number
}

interface LlmDedupResult {
  same: boolean
  reason: string
}

function pairHash(a: string, b: string): string {
  const sorted = [a, b].sort()
  return createHash('sha256').update(sorted.join('||')).digest('hex').slice(0, 16)
}

export async function llmDedup(
  candidates: FeedItem[],
  recentItems: { title: string; content: string }[],
  client: LlmClient,
  db: Database.Database,
  similarityThreshold: number = 0.55
): Promise<FeedItem[]> {
  if (recentItems.length === 0) return candidates

  const result: FeedItem[] = []
  const ambiguousPairs: DedupPair[] = []

  // Step 1: Compute similarity for each candidate against all recent items
  for (const candidate of candidates) {
    let dominated = false
    let hasAmbiguous = false

    for (let i = 0; i < recentItems.length; i++) {
      const sim = computePairwiseSimilarity(
        { title: candidate.title, content: candidate.content },
        { title: recentItems[i].title, content: recentItems[i].content }
      )

      if (sim >= similarityThreshold) {
        // Clear duplicate — skip this candidate
        dominated = true
        break
      }
      if (sim >= AMBIGUOUS_LOW) {
        // Ambiguous zone — need LLM judgment
        ambiguousPairs.push({ candidate, matchIndex: i, similarity: sim })
        hasAmbiguous = true
      }
    }

    if (dominated) continue
    if (!hasAmbiguous) {
      result.push(candidate) // clearly unique
    }
    // ambiguous ones will be resolved below
  }

  // Step 2: Resolve ambiguous pairs via LLM (with cache)
  const resolvedAsDuplicate = new Set<string>()

  // Process in chunks of BATCH_SIZE
  for (let i = 0; i < ambiguousPairs.length; i += BATCH_SIZE) {
    const chunk = ambiguousPairs.slice(i, i + BATCH_SIZE)

    for (const pair of chunk) {
      if (resolvedAsDuplicate.has(pair.candidate.id)) continue

      const hash = pairHash(
        pair.candidate.content_hash || pair.candidate.id,
        `recent_${pair.matchIndex}`
      )

      // Check cache first
      const cached = getLlmDedupResult(db, hash)
      if (cached !== null) {
        if (cached) resolvedAsDuplicate.add(pair.candidate.id)
        continue
      }

      // Ask LLM
      try {
        const systemPrompt = '你是一个新闻去重助手。判断两条新闻是否报道同一事件。以JSON格式回复：{"same": true/false, "reason": "简要原因"}'
        const userMsg = `新闻A标题: ${pair.candidate.title}\n新闻A内容: ${pair.candidate.content?.slice(0, 200)}\n\n新闻B标题: ${recentItems[pair.matchIndex].title}\n新闻B内容: ${recentItems[pair.matchIndex].content?.slice(0, 200)}`

        const llmResult = await client.chatCompletionJson<LlmDedupResult>(systemPrompt, userMsg)

        cacheLlmDedupResult(db, hash, llmResult.same)
        if (llmResult.same) {
          resolvedAsDuplicate.add(pair.candidate.id)
        }
      } catch (err) {
        // LLM failure — fall through to similarity-only (fail-safe: keep the candidate)
        process.stderr.write(`[llm-dedup] LLM call failed, keeping candidate: ${(err as Error).message}\n`)
      }
    }
  }

  // Step 3: Add ambiguous candidates that were NOT resolved as duplicates
  for (const pair of ambiguousPairs) {
    if (!resolvedAsDuplicate.has(pair.candidate.id) && !result.find(r => r.id === pair.candidate.id)) {
      result.push(pair.candidate)
    }
  }

  return result
}
