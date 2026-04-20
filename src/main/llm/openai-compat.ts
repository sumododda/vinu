import OpenAI from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import type { LLMClient, LLMConfig, NoteChunk } from './client';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import { mapOpenAIError } from './errors';

type OpenAiLike = {
  chat: {
    completions: {
      create: (
        args: {
          model: string;
          stream: true;
          messages: Array<{ role: 'system' | 'user'; content: string }>;
        },
        opts?: { signal?: AbortSignal },
      ) => Promise<AsyncIterable<ChatCompletionChunk>>;
    };
  };
};

// OpenAI SDK defaults: maxRetries=2, timeout=10 minutes. See anthropic.ts for
// the rationale — we keep retry count and shrink the request timeout.
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 60_000;

export class OpenAICompatClient implements LLMClient {
  private readonly sdk: OpenAiLike;

  constructor(private readonly config: LLMConfig, sdk?: OpenAiLike) {
    if (!sdk && !config.baseUrl) {
      // No safe default — without an explicit baseUrl the SDK would route to
      // api.openai.com, which could leak a non-OpenAI key to OpenAI.
      throw new Error('OpenAICompatClient requires config.baseUrl');
    }
    this.sdk =
      sdk ??
      (new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        maxRetries: DEFAULT_MAX_RETRIES,
        timeout: DEFAULT_TIMEOUT_MS,
      }) as unknown as OpenAiLike);
  }

  async *streamNotes(
    transcript: string,
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<NoteChunk> {
    let stream: AsyncIterable<ChatCompletionChunk>;
    try {
      stream = await this.sdk.chat.completions.create(
        {
          model: this.config.model,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(transcript) },
          ],
        },
        opts?.signal ? { signal: opts.signal } : undefined,
      );
    } catch (err) {
      throw mapOpenAIError(err);
    }

    try {
      for await (const event of stream) {
        const delta = event.choices[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          yield { delta };
        }
      }
    } catch (err) {
      throw mapOpenAIError(err);
    }
  }
}
