import { generateText } from 'ai';
import { getConfig } from '../../config/config.js';
import { createChildLogger } from '../../shared/logger.js';
import { formatStructuredText } from './aggregator.js';
import { getSummarizationModel } from '../llm/factory.js';
import type { ScoredEvent } from '../../types/event.js';

const log = createChildLogger({ module: 'summarizer' });

export async function summarizeBatch(events: ScoredEvent[]): Promise<string> {
  const config = getConfig();

  // Small batches or urgent: use structured text
  if (events.length <= config.scoring.batch_summarization_threshold) {
    return formatStructuredText(events);
  }

  // Large batches: use AI for topic-clustered summary
  try {
    const eventList = events.map((e, i) =>
      `${i + 1}. [${e.urgency_score}] ${e.title} — ${e.source_name} (${e.category_tags.join(', ')})\n   ${e.summary}`
    ).join('\n');

    const { text } = await generateText({
      model: getSummarizationModel(),
      prompt: `You are a news digest assistant. Summarize these ${events.length} news events into a concise topic-clustered digest. Group by theme, highlight the most urgent items first. Be concise but informative.\n\nEvents:\n${eventList}`,
      temperature: 0.3,
    });

    log.info({ eventCount: events.length }, 'Batch summarized with AI');
    return text;
  } catch (error) {
    log.warn({ err: error, eventCount: events.length }, 'Summarization failed, falling back to structured text');
    return formatStructuredText(events);
  }
}
