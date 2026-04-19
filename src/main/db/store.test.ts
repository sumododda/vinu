import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from './index';
import { NoteStore, type NoteStatus } from './store';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function freshStore(): NoteStore {
  const dir = mkdtempSync(join(tmpdir(), 'vn-'));
  return new NoteStore(openDatabase(join(dir, 'test.db')));
}

describe('NoteStore', () => {
  let store: NoteStore;
  beforeEach(() => {
    store = freshStore();
  });

  it('creates a note in transcribing state', () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 12345 });
    const note = store.get('n1')!;
    expect(note.status).toBe<NoteStatus>('transcribing');
    expect(note.audioPath).toBe('/tmp/a.webm');
    expect(note.durationMs).toBe(12345);
    expect(note.title).toBe('');
    expect(note.markdown).toBe('');
  });

  it('lists notes in reverse chronological order', () => {
    store.create({ id: 'n1', audioPath: '/tmp/1.webm', durationMs: 1 });
    store.create({ id: 'n2', audioPath: '/tmp/2.webm', durationMs: 2 });
    const list = store.list();
    expect(list.map((n) => n.id)).toEqual(['n2', 'n1']);
  });

  it('updates status and error message', () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 1 });
    store.updateStatus('n1', 'transcription_failed', 'whisper crashed');
    const note = store.get('n1')!;
    expect(note.status).toBe<NoteStatus>('transcription_failed');
    expect(note.errorMessage).toBe('whisper crashed');
  });

  it('sets transcript', () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 1 });
    store.setTranscript('n1', 'hello world');
    expect(store.get('n1')!.transcript).toBe('hello world');
  });

  it('sets markdown + title and marks ready', () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 1 });
    store.setMarkdown('n1', '# Hi\n\nbody', 'Hi', 'claude-opus-4-7', 'anthropic');
    const note = store.get('n1')!;
    expect(note.title).toBe('Hi');
    expect(note.markdown).toBe('# Hi\n\nbody');
    expect(note.status).toBe<NoteStatus>('ready');
    expect(note.modelUsed).toBe('claude-opus-4-7');
    expect(note.provider).toBe('anthropic');
  });

  it('updateMarkdown bumps updated_at and replaces title', () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 1 });
    store.setMarkdown('n1', '# Hi', 'Hi', 'm', 'p');
    const before = store.get('n1')!.updatedAt;
    const start = Date.now();
    while (Date.now() === start) { /* spin until clock advances */ }
    store.updateMarkdown('n1', '# Renamed\n\nbody', 'Renamed');
    const after = store.get('n1')!;
    expect(after.title).toBe('Renamed');
    expect(after.updatedAt).toBeGreaterThan(before);
  });

  it('deletes a note', () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 1 });
    store.delete('n1');
    expect(store.get('n1')).toBeUndefined();
  });

  it('deleteAudio nulls audio_path but keeps the note', () => {
    store.create({ id: 'n1', audioPath: '/tmp/a.webm', durationMs: 1 });
    store.deleteAudio('n1');
    expect(store.get('n1')!.audioPath).toBeNull();
  });

  it('full-text search finds notes by markdown content', () => {
    store.create({ id: 'n1', audioPath: '/tmp/1.webm', durationMs: 1 });
    store.create({ id: 'n2', audioPath: '/tmp/2.webm', durationMs: 1 });
    store.setMarkdown('n1', '# Meeting\n\nDiscussed pelicans', 'Meeting', 'm', 'p');
    store.setMarkdown('n2', '# Lunch\n\nDiscussed sandwiches', 'Lunch', 'm', 'p');
    const hits = store.list({ search: 'pelican' });
    expect(hits.map((h) => h.id)).toEqual(['n1']);
  });

  it('full-text search supports prefix match', () => {
    store.create({ id: 'n1', audioPath: '/tmp/1.webm', durationMs: 1 });
    store.setMarkdown('n1', '# Notes\n\nPelicanesque ideas', 'Notes', 'm', 'p');
    expect(store.list({ search: 'pel' }).length).toBe(1);
  });
});
