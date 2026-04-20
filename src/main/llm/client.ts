import type { Provider } from '@shared/types';

export interface NoteChunk {
  delta: string;
}

export interface LLMClient {
  streamNotes(transcript: string, opts?: { signal?: AbortSignal }): AsyncIterable<NoteChunk>;
}

export interface LLMConfig {
  provider: Provider;
  apiKey: string;
  baseUrl?: string;
  model: string;
}
