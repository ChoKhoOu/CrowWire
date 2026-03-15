import type { CrowWireEvent } from '../../types/event.js';

export function buildScoringPrompt(event: CrowWireEvent): string {
  return `Score this news event for urgency, relevance, and novelty.

Title: ${event.title}
Source: ${event.source_name}
Published: ${event.published_at.toISOString()}
Tags: ${event.tags.join(', ')}
Summary: ${event.summary}

Scoring guidelines:
- urgency_score (0-100): How time-sensitive is this? 90+ = breaking news requiring immediate attention. 70-89 = important, monitor closely. 50-69 = noteworthy but not urgent. <50 = routine.
- relevance_score (0-100): How relevant to finance, technology, macro-economics, or geopolitics? 80+ = directly impacts markets/industry. 50-79 = indirectly related. <50 = tangential.
- novelty_score (0-100): How new or unexpected? 80+ = first report of something surprising. 50-79 = developing story with new details. <50 = routine update or well-known topic.
- category_tags: Assign 1-3 tags from: finance, tech, macro, geopolitics, crypto, energy, commodities, regulatory, earnings, ipo, m&a, other.
- reason: Brief 1-2 sentence justification.

Use the score_event tool to provide your response.`;
}
