export interface ScoreResult {
  urgency_score: number;      // 0-100
  relevance_score: number;    // 0-100
  novelty_score: number;      // 0-100
  category_tags: string[];
  reason: string;             // 1-2 sentence explanation
}
