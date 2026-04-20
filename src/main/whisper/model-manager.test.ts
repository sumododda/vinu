import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WhisperModelManager } from './model-manager';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Build a minimal Response-like object with an async-iterable body. */
function makeResponse(opts: {
  status?: number;
  ok?: boolean;
  chunks?: Buffer[];
  iterError?: Error;
}): {
  status: number;
  ok: boolean;
  body: AsyncIterable<Buffer>;
} {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  const chunks = opts.chunks ?? [];
  const iterError = opts.iterError;
  return {
    status,
    ok,
    body: {
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c;
        if (iterError) throw iterError;
      },
    },
  };
}

describe('WhisperModelManager', () => {
  it('returns existing path when file exists and hash matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'));
    const path = join(dir, 'base.en.bin');
    writeFileSync(path, 'hello');
    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: sha256(Buffer.from('hello')) } },
      fetch: vi.fn(),
    });
    const p = await m.ensure('base.en');
    expect(p).toBe(path);
  });

  it('downloads when file is missing, verifies hash, returns path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'));
    const body = Buffer.from('world');
    const fetch = vi.fn().mockResolvedValue(makeResponse({ chunks: [body] }));
    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: sha256(body) } },
      fetch,
    });
    const p = await m.ensure('base.en');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p)).toEqual(body);
  });

  it('rejects when downloaded hash does not match and does not retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'));
    const body = Buffer.from('mismatch');
    const fetch = vi.fn().mockResolvedValue(makeResponse({ chunks: [body] }));
    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: 'deadbeef'.repeat(8) } },
      fetch,
    });
    await expect(m.ensure('base.en')).rejects.toThrow(/sha256/i);
    // Non-retryable: exactly one fetch, and .part was cleaned up.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, 'base.en.bin.part'))).toBe(false);
  });

  it('retries on transient network failure and succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'));
    const body = Buffer.from('retry-success');

    const transient = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

    const fetch = vi
      .fn()
      // First call: body throws midway.
      .mockResolvedValueOnce(makeResponse({ iterError: transient }))
      // Second call: succeeds.
      .mockResolvedValueOnce(makeResponse({ chunks: [body] }));

    const sleep = vi.fn().mockResolvedValue(undefined);
    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: sha256(body) } },
      fetch,
      sleep,
    });

    const p = await m.ensure('base.en');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p)).toEqual(body);
    expect(fetch).toHaveBeenCalledTimes(2);
    // Exponential backoff: first retry waits backoffBaseMs * 2^0 = 1000ms.
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('resumes download from existing .part file using Range header', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'));
    const full = Buffer.from('abcdefghij'); // 10 bytes
    const head = full.subarray(0, 4); // "abcd"
    const tail = full.subarray(4); // "efghij"

    // Pre-populate the .part file to simulate a previous aborted download.
    const partPath = join(dir, 'base.en.bin.part');
    writeFileSync(partPath, head);

    const fetch = vi.fn().mockResolvedValue(
      makeResponse({ status: 206, chunks: [tail] }),
    );

    const progress: number[] = [];
    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: sha256(full) } },
      fetch,
      onProgress: (_k, bytes) => progress.push(bytes),
    });

    const p = await m.ensure('base.en');
    expect(readFileSync(p)).toEqual(full);

    // Verify the request actually carried a Range header starting at the pre-existing offset.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0];
    expect(init?.headers?.Range).toBe(`bytes=${head.length}-`);

    // Progress accounts for the pre-existing bytes: first report is at 4 (head),
    // final report is at 10 (full).
    expect(progress[0]).toBe(head.length);
    expect(progress[progress.length - 1]).toBe(full.length);
  });

  it('restarts from scratch when server ignores Range and returns 200', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'));
    const full = Buffer.from('FULLRESTART');

    // Pre-populate garbage bytes.
    const partPath = join(dir, 'base.en.bin.part');
    writeFileSync(partPath, Buffer.from('XXXX'));

    const fetch = vi.fn().mockResolvedValue(
      // Server replied 200 OK despite our Range request — we should truncate.
      makeResponse({ status: 200, chunks: [full] }),
    );

    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: sha256(full) } },
      fetch,
    });
    const p = await m.ensure('base.en');
    expect(readFileSync(p)).toEqual(full);
  });

  it('does not retry on HTTP 404 (fatal)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'));
    const fetch = vi.fn().mockResolvedValue(makeResponse({ status: 404, ok: false }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: sha256(Buffer.from('x')) } },
      fetch,
      sleep,
    });
    await expect(m.ensure('base.en')).rejects.toThrow(/404/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after maxAttempts transient failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'));
    const transient = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const fetch = vi.fn().mockResolvedValue(makeResponse({ iterError: transient }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: sha256(Buffer.from('z')) } },
      fetch,
      sleep,
      maxAttempts: 3,
    });
    await expect(m.ensure('base.en')).rejects.toThrow(/socket hang up/);
    expect(fetch).toHaveBeenCalledTimes(3);
    // 2 sleeps between 3 attempts (1s, 2s).
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it('honors AbortSignal and leaves .part in place for resume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'));
    const body = Buffer.from('abort-me');

    const ac = new AbortController();
    const fetch = vi.fn().mockImplementation(async () => {
      // Simulate a long-running stream that fires many small chunks so we can
      // abort mid-stream.
      return {
        status: 200,
        ok: true,
        body: {
          async *[Symbol.asyncIterator]() {
            yield body.subarray(0, 3);
            // Trigger the abort between chunks.
            ac.abort();
            // Yield once more; the loop in model-manager checks signal.aborted
            // and bails before writing.
            yield body.subarray(3);
          },
        },
      };
    });

    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: sha256(body) } },
      fetch,
    });

    await expect(m.ensure('base.en', { signal: ac.signal })).rejects.toThrow(/abort/i);
    // .part should still exist (so a subsequent call can resume).
    const partPath = join(dir, 'base.en.bin.part');
    expect(existsSync(partPath)).toBe(true);
    // It has at most the bytes written before abort — at least the first chunk.
    expect(statSync(partPath).size).toBeGreaterThanOrEqual(3);
  });
});
