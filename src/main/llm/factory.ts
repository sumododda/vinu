import type { Settings } from '../settings';
import { AnthropicClient } from './anthropic';
import { OpenAICompatClient } from './openai-compat';
import type { LLMClient } from './client';

export function createLLMClient(settings: Settings): LLMClient {
  if (!settings.apiKey) throw new Error('API key is not configured');

  switch (settings.provider) {
    case 'anthropic':
      return new AnthropicClient({
        provider: 'anthropic',
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || undefined,
        model: settings.model,
      });
    case 'openrouter':
      return new OpenAICompatClient({
        provider: 'openrouter',
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || 'https://openrouter.ai/api/v1',
        model: settings.model,
      });
    case 'custom':
      if (!settings.baseUrl) throw new Error('Base URL is required for custom provider');
      return new OpenAICompatClient({
        provider: 'custom',
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
      });
  }
}
