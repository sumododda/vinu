import { describe, it, expect, vi } from 'vitest';
import { AnthropicClient } from './anthropic';

function fakeAnthropicSdk(deltas: string[]) {
  return {
    messages: {
      stream: vi.fn().mockReturnValue({
        async *[Symbol.asyncIterator]() {
          for (const d of deltas) {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: d } } as any;
          }
        },
      }),
    },
  };
}

describe('AnthropicClient', () => {
  it('yields text deltas from the SDK stream', async () => {
    const sdk = fakeAnthropicSdk(['Hello ', 'world']);
    const client = new AnthropicClient({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'claude-opus-4-7',
    }, sdk as any);

    const chunks: string[] = [];
    for await (const c of client.streamNotes('hi')) chunks.push(c.delta);
    expect(chunks.join('')).toBe('Hello world');
  });

  it('passes the configured model and an ephemeral cache_control system block', async () => {
    const sdk = fakeAnthropicSdk([]);
    const client = new AnthropicClient({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'claude-opus-4-7',
    }, sdk as any);
    for await (const _ of client.streamNotes('hi')) { /* drain */ }

    const arg = (sdk.messages.stream as any).mock.calls[0][0];
    expect(arg.model).toBe('claude-opus-4-7');
    expect(Array.isArray(arg.system)).toBe(true);
    expect(arg.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(arg.messages[0].role).toBe('user');
  });

  it('forwards an AbortSignal to the SDK', async () => {
    const sdk = fakeAnthropicSdk([]);
    const client = new AnthropicClient(
      { provider: 'anthropic', apiKey: 'k', model: 'm' },
      sdk as any,
    );
    const ctrl = new AbortController();
    for await (const _ of client.streamNotes('hi', { signal: ctrl.signal })) { /* drain */ }
    const opts = (sdk.messages.stream as any).mock.calls[0][1];
    expect(opts.signal).toBe(ctrl.signal);
  });
});
