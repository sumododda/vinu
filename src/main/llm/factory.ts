import type { Provider } from '@shared/types';
import type { Settings } from '../settings';
import { AnthropicClient } from './anthropic';
import { OpenAICompatClient } from './openai-compat';
import type { LLMClient } from './client';

export function createLLMClient(settings: Settings): LLMClient {
  if (!settings.apiKey) throw new Error('API key is not configured');

  const provider: Provider = settings.provider;
  switch (provider) {
    case 'anthropic':
      return new AnthropicClient({
        provider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || undefined,
        model: settings.model,
      });
    case 'openrouter':
      return new OpenAICompatClient({
        provider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || 'https://openrouter.ai/api/v1',
        model: settings.model,
      });
    case 'custom':
      if (!settings.baseUrl) throw new Error('Base URL is required for custom provider');
      return new OpenAICompatClient({
        provider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
      });
  }
}
