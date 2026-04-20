import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WhisperRunner } from './whisper-runner';

const fakeJson = JSON.stringify({
  transcription: [
    { offsets: { from: 0, to: 1500 }, text: ' Hello ' },
    { offsets: { from: 1500, to: 3000 }, text: 'world.' },
  ],
});

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeWavPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'whisper-runner-test-'));
  tmpDirs.push(dir);
  return join(dir, 'a.wav');
}

function jsonPathFor(wavPath: string) {
  return wavPath.replace(/\.wav$/i, '') + '.json';
}

describe('WhisperRunner', () => {
  it('invokes the binary with model + wav and parses JSON output', async () => {
    const wavPath = makeWavPath();
    const run = vi.fn().mockImplementation(async () => {
      writeFileSync(jsonPathFor(wavPath), fakeJson);
      return { code: 0, stdout: '', stderr: '' };
    });
    const runner = new WhisperRunner({
      whisperPath: '/bin/whisper',
      modelPath: '/models/ggml-base.en.bin',
      run,
    });
    const r = await runner.transcribe(wavPath);
    expect(r.text.trim()).toBe('Hello world.');
    expect(r.segments).toHaveLength(2);
    expect(r.durationMs).toBe(3000);

    expect(run).toHaveBeenCalledWith(
      '/bin/whisper',
      expect.arrayContaining(['-m', '/models/ggml-base.en.bin', '-f', wavPath, '-ojf']),
      expect.anything(),
    );

    // Runner cleans up the output JSON.
    expect(existsSync(jsonPathFor(wavPath))).toBe(false);
  });

  it('honors language option', async () => {
    const wavPath = makeWavPath();
    const run = vi.fn().mockImplementation(async () => {
      writeFileSync(jsonPathFor(wavPath), fakeJson);
      return { code: 0, stdout: '', stderr: '' };
    });
    const runner = new WhisperRunner({
      whisperPath: '/bin/whisper',
      modelPath: '/models/m.bin',
      run,
    });
    await runner.transcribe(wavPath, { language: 'es' });
    expect(run.mock.calls[0][1]).toEqual(expect.arrayContaining(['-l', 'es']));
  });

  it('propagates failure', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    const runner = new WhisperRunner({
      whisperPath: '/bin/whisper',
      modelPath: '/models/m.bin',
      run,
    });
    await expect(runner.transcribe('/tmp/a.wav')).rejects.toThrow(/boom/);
  });
});
