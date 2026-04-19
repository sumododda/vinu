import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WhisperModelManager } from './model-manager';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
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
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        async *[Symbol.asyncIterator]() {
          yield body;
        },
      },
    });
    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: sha256(body) } },
      fetch,
    });
    const p = await m.ensure('base.en');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p)).toEqual(body);
  });

  it('rejects when downloaded hash does not match', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'));
    const body = Buffer.from('mismatch');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        async *[Symbol.asyncIterator]() {
          yield body;
        },
      },
    });
    const m = new WhisperModelManager({
      dir,
      registry: { 'base.en': { url: 'http://x/m.bin', sha256: 'deadbeef'.repeat(8) } },
      fetch,
    });
    await expect(m.ensure('base.en')).rejects.toThrow(/sha256/i);
  });
});
