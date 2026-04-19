import OpenAI from 'openai';
import type { LLMClient, LLMConfig, NoteChunk } from './client';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';

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
      ) => Promise<AsyncIterable<unknown>>;
    };
  };
};

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
      }) as unknown as OpenAiLike);
  }

  async *streamNotes(
    transcript: string,
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<NoteChunk> {
    const stream = await this.sdk.chat.completions.create(
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

    for await (const event of stream as AsyncIterable<any>) {
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        yield { delta };
      }
    }
  }
}
