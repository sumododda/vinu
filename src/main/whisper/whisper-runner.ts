import { readFile, rm } from 'node:fs/promises';
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
    // -ojf writes the JSON to `<prefix>.json` (not stdout). -of sets the prefix.
    const outputPrefix = wavPath.replace(/\.wav$/i, '');
    const jsonPath = `${outputPrefix}.json`;
    const args = [
      '-m', this.modelPath,
      '-f', wavPath,
      '-ojf',
      '-of', outputPrefix,
      '-nt',
      ...(opts?.language ? ['-l', opts.language] : []),
    ];
    try {
      await this.run(this.whisperPath, args, { signal: opts?.signal });
      const raw = await readFile(jsonPath, 'utf8');
      return parseWhisperJson(raw);
    } finally {
      await rm(jsonPath, { force: true }).catch(() => {});
    }
  }
}

function parseWhisperJson(raw: string): TranscriptResult {
  let data: WhisperJson;
  try {
    data = JSON.parse(raw) as WhisperJson;
  } catch {
    const snippet = raw.slice(0, 200);
    throw new Error(`whisper output was not valid JSON: ${snippet}`);
  }
  const segments: TranscriptSegment[] = data.transcription.map((s) => ({
    startMs: s.offsets.from,
    endMs: s.offsets.to,
    text: s.text.trim(),
  }));
  const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  const durationMs = segments.length ? segments[segments.length - 1].endMs : 0;
  return { text, segments, durationMs };
}
