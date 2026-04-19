import { describe, it, expect } from 'vitest';
import { createLLMClient } from './factory';
import { AnthropicClient } from './anthropic';
import { OpenAICompatClient } from './openai-compat';

describe('createLLMClient', () => {
  const base = {
    apiKey: 'k',
    model: 'm',
    hotkeyEnabled: false,
    hotkeyAccelerator: '',
    keepAudioDefault: true,
  };

  it('returns AnthropicClient for provider=anthropic', () => {
    const c = createLLMClient({ ...base, provider: 'anthropic', baseUrl: '', model: 'claude-opus-4-7' });
    expect(c).toBeInstanceOf(AnthropicClient);
  });

  it('returns OpenAICompatClient for openrouter and custom', () => {
    expect(
      createLLMClient({ ...base, provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' }),
    ).toBeInstanceOf(OpenAICompatClient);
    expect(
      createLLMClient({ ...base, provider: 'custom', baseUrl: 'http://localhost' }),
    ).toBeInstanceOf(OpenAICompatClient);
  });

  it('throws if api key is empty', () => {
    expect(() =>
      createLLMClient({ ...base, apiKey: '', provider: 'anthropic', baseUrl: '' }),
    ).toThrowError(/api key/i);
  });

  it('throws if custom provider has no baseUrl', () => {
    expect(() =>
      createLLMClient({ ...base, provider: 'custom', baseUrl: '' }),
    ).toThrowError(/base url/i);
  });
});
