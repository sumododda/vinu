export interface NoteChunk {
  delta: string;
}

export interface LLMClient {
  streamNotes(transcript: string, opts?: { signal?: AbortSignal }): AsyncIterable<NoteChunk>;
}

export interface LLMConfig {
  provider: 'anthropic' | 'openrouter' | 'custom';
  apiKey: string;
  baseUrl?: string;
  model: string;
}
