import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './db/runner';
import initSql from './db/migrations/001_init.sql?raw';
import foldersSql from './db/migrations/002_folders_inline.sql?raw';
import folderTreeSql from './db/migrations/003_folder_tree.sql?raw';
import { NoteStore } from './db/store';
import { Pipeline } from './pipeline';

function freshStore(): NoteStore {
  const db = new Database(':memory:');
  runMigrations(db, [
    { version: 1, sql: initSql },
    { version: 2, sql: foldersSql },
    { version: 3, sql: folderTreeSql },
  ]);
  return new NoteStore(db);
}

const baseSettings = () => ({
  provider: 'anthropic' as const,
  apiKey: 'k',
  baseUrl: '',
  model: 'claude-opus-4-7',
  hotkeyEnabled: false,
  hotkeyAccelerator: '',
  keepAudioDefault: true,
});

describe('Pipeline', () => {
  let store: NoteStore;
  beforeEach(() => {
    store = freshStore();
  });

  it('drives a note from transcribing → generating → ready and emits streaming events', async () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 1000 });

    const events: Array<{ type: string; payload: any }> = [];
    const emit = (type: string, payload: any) => events.push({ type, payload });

    const audio = { preprocess: vi.fn().mockResolvedValue('/tmp/a.wav') };
    const whisper = {
      transcribe: vi.fn().mockResolvedValue({ text: 'raw text', segments: [], durationMs: 1000 }),
    };
    const llm = {
      streamNotes: async function* () {
        yield { delta: '# Hi\n' };
        yield { delta: '\nbody' };
      },
    };

    const p = new Pipeline({
      store,
      audio: audio as any,
      whisper: whisper as any,
      makeLLMClient: () => llm as any,
      settings: baseSettings,
      emit,
    });

    await p.process('n1');

    expect(audio.preprocess).toHaveBeenCalledWith('/tmp/a.webm', expect.anything());
    expect(whisper.transcribe).toHaveBeenCalledWith('/tmp/a.wav', expect.anything());

    const finalNote = store.get('n1')!;
    expect(finalNote.status).toBe('ready');
    expect(finalNote.transcript).toBe('raw text');
    expect(finalNote.markdown).toBe('# Hi\n\nbody');
    expect(finalNote.title).toBe('Hi');
    expect(finalNote.modelUsed).toBe('claude-opus-4-7');
    expect(finalNote.provider).toBe('anthropic');

    const types = events.map((e) => e.type);
    expect(types).toContain('note:streaming');
    expect(types[types.length - 1]).toBe('note:updated');
  });

  it('marks transcription_failed when whisper throws', async () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 1 });
    const p = new Pipeline({
      store,
      audio: { preprocess: vi.fn().mockResolvedValue('/tmp/a.wav') } as any,
      whisper: { transcribe: vi.fn().mockRejectedValue(new Error('whisper bad')) } as any,
      makeLLMClient: () => ({ streamNotes: async function* () {} } as any),
      settings: baseSettings,
      emit: () => {},
    });
    await p.process('n1');
    const note = store.get('n1')!;
    expect(note.status).toBe('transcription_failed');
    expect(note.errorMessage).toMatch(/whisper bad/);
  });

  it('marks generation_failed when llm throws and preserves transcript', async () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 1 });
    const p = new Pipeline({
      store,
      audio: { preprocess: vi.fn().mockResolvedValue('/tmp/a.wav') } as any,
      whisper: { transcribe: vi.fn().mockResolvedValue({ text: 't', segments: [], durationMs: 0 }) } as any,
      makeLLMClient: () => ({
        // eslint-disable-next-line require-yield
        streamNotes: async function* () {
          throw new Error('llm bad');
        },
      } as any),
      settings: baseSettings,
      emit: () => {},
    });
    await p.process('n1');
    const note = store.get('n1')!;
    expect(note.status).toBe('generation_failed');
    expect(note.transcript).toBe('t');
    expect(note.errorMessage).toMatch(/llm bad/);
  });

  it('regenerates a note from an edited transcript without re-running whisper', async () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 1 });
    store.setTranscript('n1', 'updated transcript');
    store.setMarkdown('n1', '# Old\n\nBody', 'Old', 'm', 'p');

    const whisper = { transcribe: vi.fn() };
    const p = new Pipeline({
      store,
      audio: { preprocess: vi.fn() } as any,
      whisper: whisper as any,
      makeLLMClient: () => ({
        streamNotes: async function* () {
          yield { delta: '# Fresh\n\nRegenerated' };
        },
      } as any),
      settings: baseSettings,
      emit: () => {},
    });

    await p.regenerate('n1');

    expect(whisper.transcribe).not.toHaveBeenCalled();
    expect(store.get('n1')?.title).toBe('Fresh');
    expect(store.get('n1')?.markdown).toContain('Regenerated');
  });
});
