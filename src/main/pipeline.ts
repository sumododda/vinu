import { unlink } from 'node:fs/promises';
import type { NoteStore } from './db/store';
import type { AudioPreprocessor } from './whisper/audio-preprocessor';
import type { WhisperRunner } from './whisper/whisper-runner';
import type { LLMClient } from './llm/client';
import type { Settings } from './settings';
import { extractTitle } from '@shared/title';

export type PipelineEventType = 'note:streaming' | 'note:updated' | 'note:failed';

export interface PipelineDeps {
  store: NoteStore;
  audio: AudioPreprocessor;
  whisper: WhisperRunner;
  makeLLMClient: (s: Settings) => LLMClient;
  settings: () => Settings;
  emit: (type: PipelineEventType, payload: { id: string; markdown?: string }) => void;
}

export class Pipeline {
  constructor(private readonly deps: PipelineDeps) {}

  async process(id: string, opts?: { signal?: AbortSignal }): Promise<void> {
    const note = this.deps.store.get(id);
    if (!note?.audioPath) {
      this.deps.store.updateStatus(id, 'transcription_failed', 'audio not found');
      this.deps.emit('note:failed', { id });
      return;
    }

    let transcript: string;
    let wavPath: string | undefined;
    try {
      wavPath = await this.deps.audio.preprocess(note.audioPath, { signal: opts?.signal });
      try {
        const r = await this.deps.whisper.transcribe(wavPath, { signal: opts?.signal });
        transcript = r.text;
      } finally {
        // Preprocessed WAV is a throwaway intermediate — always clean it up,
        // whether whisper succeeded, failed, or was aborted.
        if (wavPath) await unlink(wavPath).catch(() => {});
      }
      this.deps.store.setTranscript(id, transcript);
      this.deps.store.updateStatus(id, 'generating');
      this.deps.emit('note:updated', { id });
    } catch (err) {
      this.deps.store.updateStatus(id, 'transcription_failed', errorMessage(err));
      this.deps.emit('note:failed', { id });
      return;
    }

    const generated = await this.generateFromTranscript(id, transcript, opts);
    if (!generated) return;

    // Honour keepAudioDefault: when false, drop the source audio now that the
    // summary is safely persisted. `deleteAudio` NULLs audio_path in the DB;
    // we additionally unlink the file on disk. Swallow unlink errors — the DB
    // is the source of truth and the file may already be gone.
    const settings = this.deps.settings();
    if (!settings.keepAudioDefault && note.audioPath) {
      await unlink(note.audioPath).catch(() => {});
      this.deps.store.deleteAudio(id);
    }

    this.deps.emit('note:updated', { id });
  }

  async regenerate(id: string, opts?: { signal?: AbortSignal }): Promise<void> {
    const note = this.deps.store.get(id);
    if (!note) {
      this.deps.emit('note:failed', { id });
      return;
    }

    const transcript = note.transcript.trim();
    if (!transcript) {
      this.deps.store.updateStatus(id, 'generation_failed', 'transcript is empty');
      this.deps.emit('note:failed', { id });
      return;
    }

    this.deps.store.updateStatus(id, 'generating');
    this.deps.emit('note:updated', { id });

    const generated = await this.generateFromTranscript(id, transcript, opts);
    if (!generated) return;
    this.deps.emit('note:updated', { id });
  }

  private async generateFromTranscript(
    id: string,
    transcript: string,
    opts?: { signal?: AbortSignal },
  ): Promise<boolean> {
    let buffer = '';
    const settings = this.deps.settings();
    try {
      const client = this.deps.makeLLMClient(settings);
      for await (const chunk of client.streamNotes(transcript, { signal: opts?.signal })) {
        buffer += chunk.delta;
        this.deps.emit('note:streaming', { id, markdown: buffer });
      }
      const title = extractTitle(buffer);
      this.deps.store.setMarkdown(id, buffer, title, settings.model, settings.provider);
      return true;
    } catch (err) {
      this.deps.store.updateStatus(id, 'generation_failed', errorMessage(err));
      this.deps.emit('note:failed', { id });
      return false;
    }
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
