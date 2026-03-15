import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getConfig } from '../../config/config.js';
import type { LanguageModel } from 'ai';

let _scoringModel: LanguageModel | null = null;
let _summarizationModel: LanguageModel | null = null;

function createModel(modelName: string): LanguageModel {
  const config = getConfig();
  const { provider, api_key, base_url } = config.llm;

  if (provider === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: api_key,
      ...(base_url ? { baseURL: base_url } : {}),
    });
    return anthropic(modelName);
  }

  const openai = createOpenAI({
    apiKey: api_key,
    ...(base_url ? { baseURL: base_url } : {}),
  });
  return openai(modelName);
}

export function getScoringModel(): LanguageModel {
  if (!_scoringModel) {
    _scoringModel = createModel(getConfig().llm.scoring_model);
  }
  return _scoringModel;
}

export function getSummarizationModel(): LanguageModel {
  if (!_summarizationModel) {
    _summarizationModel = createModel(getConfig().llm.summarization_model);
  }
  return _summarizationModel;
}
