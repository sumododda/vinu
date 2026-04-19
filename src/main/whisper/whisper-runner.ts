import { runProcess, type ProcessResult } from '../util/subprocess';

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  durationMs: number;
}

export interface WhisperRunnerDeps {
  whisperPath: string;
  modelPath: string;
  run?: (cmd: string, args: string[], opts?: { signal?: AbortSignal }) => Promise<ProcessResult>;
}

interface WhisperJson {
  transcription: Array<{
    offsets: { from: number; to: number };
    text: string;
  }>;
}

export class WhisperRunner {
  private readonly whisperPath: string;
  private readonly modelPath: string;
  private readonly run: NonNullable<WhisperRunnerDeps['run']>;

  constructor(deps: WhisperRunnerDeps) {
    this.whisperPath = deps.whisperPath;
    this.modelPath = deps.modelPath;
    this.run = deps.run ?? runProcess;
  }

  async transcribe(
    wavPath: string,
    opts?: { language?: string; signal?: AbortSignal },
  ): Promise<TranscriptResult> {
    const args = [
      '-m', this.modelPath,
      '-f', wavPath,
      '-ojf',
      '-nt',
      ...(opts?.language ? ['-l', opts.language] : []),
    ];
    const { stdout } = await this.run(this.whisperPath, args, { signal: opts?.signal });
    return parseWhisperJson(stdout);
  }
}

function parseWhisperJson(raw: string): TranscriptResult {
  const data = JSON.parse(raw) as WhisperJson;
  const segments: TranscriptSegment[] = data.transcription.map((s) => ({
    startMs: s.offsets.from,
    endMs: s.offsets.to,
    text: s.text.trim(),
  }));
  const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  const durationMs = segments.length ? segments[segments.length - 1].endMs : 0;
  return { text, segments, durationMs };
}
