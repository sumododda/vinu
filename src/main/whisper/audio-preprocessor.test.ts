import { describe, it, expect, vi } from 'vitest';
import { AudioPreprocessor } from './audio-preprocessor';

describe('AudioPreprocessor', () => {
  it('runs ffmpeg with 16k mono wav args and returns the output path', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    const pre = new AudioPreprocessor({
      ffmpegPath: '/bin/ffmpeg',
      tmpDir: '/tmp/vn',
      now: () => 1700000000000,
      run,
    });
    const out = await pre.preprocess('/in/a.webm');
    expect(out).toBe('/tmp/vn/1700000000000.wav');
    expect(run).toHaveBeenCalledWith(
      '/bin/ffmpeg',
      ['-y', '-i', '/in/a.webm', '-ar', '16000', '-ac', '1', '-f', 'wav', '/tmp/vn/1700000000000.wav'],
      expect.anything(),
    );
  });

  it('propagates ffmpeg failure', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ffmpeg crashed'));
    const pre = new AudioPreprocessor({
      ffmpegPath: '/bin/ffmpeg',
      tmpDir: '/tmp/vn',
      now: () => 1,
      run,
    });
    await expect(pre.preprocess('/in/a.webm')).rejects.toThrow(/ffmpeg crashed/);
  });
});
