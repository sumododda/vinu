import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess, type ProcessResult } from '../util/subprocess';

export interface AudioPreprocessorDeps {
  ffmpegPath: string;
  tmpDir: string;
  now?: () => number;
  run?: (cmd: string, args: string[], opts?: { signal?: AbortSignal }) => Promise<ProcessResult>;
}

export class AudioPreprocessor {
  private readonly ffmpegPath: string;
  private readonly tmpDir: string;
  private readonly now: () => number;
  private readonly run: NonNullable<AudioPreprocessorDeps['run']>;

  constructor(deps: AudioPreprocessorDeps) {
    this.ffmpegPath = deps.ffmpegPath;
    this.tmpDir = deps.tmpDir;
    this.now = deps.now ?? Date.now;
    this.run = deps.run ?? runProcess;
  }

  async preprocess(inputPath: string, opts?: { signal?: AbortSignal }): Promise<string> {
    await mkdir(this.tmpDir, { recursive: true });
    const out = join(this.tmpDir, `${this.now()}.wav`);
    await this.run(
      this.ffmpegPath,
      ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 'wav', out],
      { signal: opts?.signal },
    );
    return out;
  }
}
