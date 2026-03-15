import { generateObject } from 'ai';
import { z } from 'zod';
import { createChildLogger } from '../../shared/logger.js';
import { TransientError, PermanentError } from '../../types/errors.js';
import type { CrowWireEvent } from '../../types/event.js';
import type { ScoreResult } from '../../types/scoring.js';
import { buildScoringPrompt } from './prompt.js';
import { getScoringModel } from '../llm/factory.js';

const log = createChildLogger({ module: 'model-client' });

const scoreResultSchema = z.object({
  urgency_score: z.number().int().min(0).max(100),
  relevance_score: z.number().int().min(0).max(100),
  novelty_score: z.number().int().min(0).max(100),
  category_tags: z.array(z.string()).min(1),
  reason: z.string().min(1),
});

export class ModelClient {
  async score(event: CrowWireEvent): Promise<ScoreResult> {
    const prompt = buildScoringPrompt(event);

    try {
      const { object } = await generateObject({
        model: getScoringModel(),
        schema: scoreResultSchema,
        prompt,
        temperature: 0.1,
      });

      return object;
    } catch (err: unknown) {
      if (err instanceof Error) {
        const msg = err.message;
        if (msg.includes('rate') || msg.includes('429') || msg.includes('timeout') || msg.includes('5xx') || msg.includes('500') || msg.includes('503')) {
          throw new TransientError(`LLM API error: ${msg}`, err);
        }
        if (err.name === 'AbortError') {
          throw new TransientError(`LLM API timeout: ${msg}`, err);
        }
        log.warn({ err }, 'LLM scoring failed');
        throw new PermanentError(`LLM API error: ${msg}`, err);
      }
      throw new TransientError(`LLM API error: ${String(err)}`);
    }
  }
}
