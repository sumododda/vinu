import { describe, it, expect, vi } from 'vitest';
import { WhisperRunner } from './whisper-runner';

const fakeJson = JSON.stringify({
  transcription: [
    { offsets: { from: 0, to: 1500 }, text: ' Hello ' },
    { offsets: { from: 1500, to: 3000 }, text: 'world.' },
  ],
});

describe('WhisperRunner', () => {
  it('invokes the binary with model + wav and parses JSON output', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: fakeJson, stderr: '' });
    const runner = new WhisperRunner({
      whisperPath: '/bin/whisper',
      modelPath: '/models/ggml-base.en.bin',
      run,
    });
    const r = await runner.transcribe('/tmp/a.wav');
    expect(r.text.trim()).toBe('Hello world.');
    expect(r.segments).toHaveLength(2);
    expect(r.durationMs).toBe(3000);

    expect(run).toHaveBeenCalledWith(
      '/bin/whisper',
      expect.arrayContaining(['-m', '/models/ggml-base.en.bin', '-f', '/tmp/a.wav', '-ojf']),
      expect.anything(),
    );
  });

  it('honors language option', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: fakeJson, stderr: '' });
    const runner = new WhisperRunner({
      whisperPath: '/bin/whisper',
      modelPath: '/models/m.bin',
      run,
    });
    await runner.transcribe('/tmp/a.wav', { language: 'es' });
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
