import Anthropic from '@anthropic-ai/sdk';
import type { LLMClient, LLMConfig, NoteChunk } from './client';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';

type AnthropicLike = {
  messages: {
    stream: (
      args: {
        model: string;
        max_tokens: number;
        system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
        messages: Array<{ role: 'user'; content: string }>;
      },
      opts?: { signal?: AbortSignal },
    ) => AsyncIterable<unknown>;
  };
};

export class AnthropicClient implements LLMClient {
  private readonly sdk: AnthropicLike;

  constructor(private readonly config: LLMConfig, sdk?: AnthropicLike) {
    this.sdk =
      sdk ??
      (new Anthropic({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      }) as unknown as AnthropicLike);
  }

  async *streamNotes(
    transcript: string,
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<NoteChunk> {
    const stream = this.sdk.messages.stream(
      {
        model: this.config.model,
        max_tokens: 4096,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: buildUserPrompt(transcript) }],
      },
      opts?.signal ? { signal: opts.signal } : undefined,
    );

    for await (const event of stream as AsyncIterable<any>) {
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        yield { delta: event.delta.text as string };
      }
    }
  }
}
