import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { createChildLogger } from '../../shared/logger.js';
import { TransientError, PermanentError } from '../../types/errors.js';
import type { CrowWireEvent } from '../../types/event.js';
import type { ScoreResult } from '../../types/scoring.js';
import { buildScoringPrompt } from './prompt.js';

const log = createChildLogger({ module: 'model-client' });

const scoreResultSchema = z.object({
  urgency_score: z.number().int().min(0).max(100),
  relevance_score: z.number().int().min(0).max(100),
  novelty_score: z.number().int().min(0).max(100),
  category_tags: z.array(z.string()).min(1),
  reason: z.string().min(1),
});

const scoreTool: Anthropic.Tool = {
  name: 'score_event',
  description: 'Score a news event for urgency, relevance, and novelty',
  input_schema: {
    type: 'object' as const,
    properties: {
      urgency_score: { type: 'number', description: 'Urgency score 0-100. 90+ for breaking/critical news.' },
      relevance_score: { type: 'number', description: 'Relevance score 0-100 for market/tech/geopolitics.' },
      novelty_score: { type: 'number', description: 'Novelty score 0-100. How new/unexpected is this?' },
      category_tags: { type: 'array', items: { type: 'string' }, description: 'Category tags: finance, tech, geopolitics, macro, crypto, etc.' },
      reason: { type: 'string', description: '1-2 sentence explanation of the scores.' },
    },
    required: ['urgency_score', 'relevance_score', 'novelty_score', 'category_tags', 'reason'],
  },
};

export class ModelClient {
  private client: Anthropic;
  private model: string;

  constructor(config: { apiKey: string; model: string }) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      timeout: 30_000, // 30 second timeout
    });
    this.model = config.model;
  }

  async score(event: CrowWireEvent): Promise<ScoreResult> {
    const prompt = buildScoringPrompt(event);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        temperature: 0.1,
        tools: [scoreTool],
        tool_choice: { type: 'tool', name: 'score_event' },
        messages: [{ role: 'user', content: prompt }],
      });

      // Extract tool use result
      const toolUseBlock = response.content.find(block => block.type === 'tool_use');
      if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
        throw new PermanentError('Model did not return tool_use block');
      }

      const parsed = scoreResultSchema.safeParse(toolUseBlock.input);
      if (!parsed.success) {
        log.warn({ errors: parsed.error.flatten(), input: toolUseBlock.input }, 'Invalid score result');
        throw new PermanentError(`Invalid score result: ${parsed.error.message}`);
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof PermanentError) throw error;

      if (error instanceof Anthropic.APIError) {
        if (error.status && error.status >= 500) {
          throw new TransientError(`Anthropic API 5xx: ${error.message}`, error);
        }
        if (error.status === 429) {
          throw new TransientError(`Anthropic API rate limit: ${error.message}`, error);
        }
        throw new PermanentError(`Anthropic API ${error.status}: ${error.message}`, error);
      }

      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('timeout'))) {
        throw new TransientError(`Model API timeout: ${error.message}`, error);
      }

      throw new TransientError(`Model API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
