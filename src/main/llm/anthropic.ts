import Anthropic from '@anthropic-ai/sdk';
import type { Messages } from '@anthropic-ai/sdk/resources/messages/messages';
import type { LLMClient, LLMConfig, NoteChunk } from './client';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import { mapAnthropicError } from './errors';

// SDK-provided streaming event union. Using the SDK type (instead of `any`)
// means downstream additions to the event variants surface as type errors
// instead of silent runtime branches.
type AnthropicStreamEvent = Messages.RawMessageStreamEvent;

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
    ) => AsyncIterable<AnthropicStreamEvent>;
  };
};

// Anthropic SDK defaults: maxRetries=2, timeout=10 minutes. We shorten the
// timeout so a stuck generate fails fast (the pipeline will surface it to the
// UI) while keeping the retry count at the SDK default. `timeout` governs the
// overall request; streaming data continues to flow after headers are
// received.
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 60_000;

export class AnthropicClient implements LLMClient {
  private readonly sdk: AnthropicLike;

  constructor(private readonly config: LLMConfig, sdk?: AnthropicLike) {
    this.sdk =
      sdk ??
      (new Anthropic({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        maxRetries: DEFAULT_MAX_RETRIES,
        timeout: DEFAULT_TIMEOUT_MS,
      }) as unknown as AnthropicLike);
  }

  async *streamNotes(
    transcript: string,
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<NoteChunk> {
    let stream: AsyncIterable<AnthropicStreamEvent>;
    try {
      stream = this.sdk.messages.stream(
        {
          model: this.config.model,
          max_tokens: 4096,
          system: [
            // cache_control is forward-compatible; Anthropic only activates the
            // ephemeral cache once the block reaches ~1024 tokens. SYSTEM_PROMPT
            // is currently under that threshold, so this is a no-op until the
            // prompt grows.
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: buildUserPrompt(transcript) }],
        },
        opts?.signal ? { signal: opts.signal } : undefined,
      );
    } catch (err) {
      throw mapAnthropicError(err);
    }

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { delta: event.delta.text };
        }
      }
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}
