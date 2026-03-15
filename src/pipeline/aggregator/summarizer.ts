import Anthropic from '@anthropic-ai/sdk';
import { getEnv } from '../../config/env.js';
import { createChildLogger } from '../../shared/logger.js';
import { formatStructuredText } from './aggregator.js';
import type { ScoredEvent } from '../../types/event.js';

const log = createChildLogger({ module: 'summarizer' });

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const env = getEnv();
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function summarizeBatch(events: ScoredEvent[]): Promise<string> {
  const env = getEnv();

  // Small batches or urgent: use structured text
  if (events.length <= env.BATCH_SUMMARIZATION_THRESHOLD) {
    return formatStructuredText(events);
  }

  // Large batches: use Sonnet 4.6 for topic-clustered summary
  try {
    const client = getClient();
    const eventList = events.map((e, i) =>
      `${i + 1}. [${e.urgency_score}] ${e.title} — ${e.source_name} (${e.category_tags.join(', ')})\n   ${e.summary}`
    ).join('\n');

    const response = await client.messages.create({
      model: env.SUMMARIZATION_MODEL,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: `You are a news digest assistant. Summarize these ${events.length} news events into a concise topic-clustered digest. Group by theme, highlight the most urgent items first. Be concise but informative.\n\nEvents:\n${eventList}`,
      }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      log.info({ eventCount: events.length }, 'Batch summarized with AI');
      return textBlock.text;
    }

    throw new Error('No text block in summarization response');
  } catch (error) {
    log.warn({ err: error, eventCount: events.length }, 'Summarization failed, falling back to structured text');
    return formatStructuredText(events);
  }
}
