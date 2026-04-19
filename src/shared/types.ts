// Pure structural types shared between the main process and the renderer.
// Must never import from 'electron', 'better-sqlite3', 'node:*', or any
// main-process module — this file is pulled into the renderer bundle.

export type NoteStatus =
  | 'transcribing'
  | 'generating'
  | 'ready'
  | 'transcription_failed'
  | 'generation_failed'
  | 'pending_network';

export interface NoteSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  status: NoteStatus;
  durationMs: number;
}

export interface Note extends NoteSummary {
  markdown: string;
  transcript: string;
  audioPath: string | null;
  errorMessage: string | null;
  modelUsed: string | null;
  provider: string | null;
}

export type Provider = 'anthropic' | 'openrouter' | 'custom';

export interface Settings {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  model: string;
  hotkeyEnabled: boolean;
  hotkeyAccelerator: string;
  keepAudioDefault: boolean;
}
