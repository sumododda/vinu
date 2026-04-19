import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatClient } from './openai-compat';

function fakeOpenAi(deltas: string[]) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          async *[Symbol.asyncIterator]() {
            for (const d of deltas) {
              yield { choices: [{ delta: { content: d } }] } as any;
            }
          },
        })),
      },
    },
  };
}

describe('OpenAICompatClient', () => {
  it('streams text deltas via chat.completions.create', async () => {
    const sdk = fakeOpenAi(['Hi ', 'there']);
    const client = new OpenAICompatClient(
      { provider: 'openrouter', apiKey: 'k', model: 'anthropic/claude-opus-4-7', baseUrl: 'https://openrouter.ai/api/v1' },
      sdk as any,
    );
    const out: string[] = [];
    for await (const c of client.streamNotes('x')) out.push(c.delta);
    expect(out.join('')).toBe('Hi there');
  });

  it('sends model, system + user messages, and stream:true', async () => {
    const sdk = fakeOpenAi([]);
    const client = new OpenAICompatClient(
      { provider: 'custom', apiKey: 'k', model: 'gpt-foo', baseUrl: 'http://localhost:11434/v1' },
      sdk as any,
    );
    for await (const _ of client.streamNotes('x')) { /* drain */ }

    const arg = (sdk.chat.completions.create as any).mock.calls[0][0];
    expect(arg.model).toBe('gpt-foo');
    expect(arg.stream).toBe(true);
    expect(arg.messages[0]).toMatchObject({ role: 'system' });
    expect(arg.messages[1]).toMatchObject({ role: 'user' });
  });

  it('aborts the create call when signal fires', async () => {
    const sdk = fakeOpenAi([]);
    const client = new OpenAICompatClient(
      { provider: 'custom', apiKey: 'k', model: 'm', baseUrl: 'x' },
      sdk as any,
    );
    const ctrl = new AbortController();
    for await (const _ of client.streamNotes('x', { signal: ctrl.signal })) { /* drain */ }
    const opts = (sdk.chat.completions.create as any).mock.calls[0][1];
    expect(opts.signal).toBe(ctrl.signal);
  });
});
