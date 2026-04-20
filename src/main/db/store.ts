import type Database from 'better-sqlite3';
import type { Note, NoteStatus, NoteSummary } from '@shared/types';

export type { Note, NoteStatus, NoteSummary };

interface NoteRow {
  id: string;
  created_at: number;
  updated_at: number;
  title: string;
  markdown: string;
  transcript: string;
  audio_path: string | null;
  duration_ms: number;
  status: NoteStatus;
  error_message: string | null;
  model_used: string | null;
  provider: string | null;
}

const ALL_COLS = `id, created_at, updated_at, title, markdown, transcript, audio_path,
  duration_ms, status, error_message, model_used, provider`;

function rowToNote(r: NoteRow): Note {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    title: r.title,
    markdown: r.markdown,
    transcript: r.transcript,
    audioPath: r.audio_path,
    durationMs: r.duration_ms,
    status: r.status,
    errorMessage: r.error_message,
    modelUsed: r.model_used,
    provider: r.provider,
  };
}

export class NoteStore {
  // Prepared statements cached for the life of the process. better-sqlite3's
  // main perf win comes from statement reuse — preparing once per call burns
  // cycles parsing SQL we already know.
  private readonly createStmt: Database.Statement;
  private readonly updateStatusStmt: Database.Statement;
  private readonly setTranscriptStmt: Database.Statement;
  private readonly setMarkdownStmt: Database.Statement;
  private readonly updateMarkdownStmt: Database.Statement;
  private readonly listSearchStmt: Database.Statement;
  private readonly listStmt: Database.Statement;
  private readonly getStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;
  private readonly deleteAudioStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.createStmt = db.prepare(
      `INSERT INTO notes (id, created_at, updated_at, audio_path, duration_ms, status)
       VALUES (?, ?, ?, ?, ?, 'transcribing')`,
    );
    this.updateStatusStmt = db.prepare(
      'UPDATE notes SET status=?, error_message=?, updated_at=? WHERE id=?',
    );
    this.setTranscriptStmt = db.prepare(
      'UPDATE notes SET transcript=?, updated_at=? WHERE id=?',
    );
    this.setMarkdownStmt = db.prepare(
      `UPDATE notes
          SET markdown=?, title=?, model_used=?, provider=?, status='ready',
              error_message=NULL, updated_at=?
        WHERE id=?`,
    );
    this.updateMarkdownStmt = db.prepare(
      'UPDATE notes SET markdown=?, title=?, updated_at=? WHERE id=?',
    );
    this.listSearchStmt = db.prepare(
      `SELECT n.id, n.created_at, n.updated_at, n.title, n.status, n.duration_ms
         FROM notes n
         JOIN notes_fts f ON f.rowid = n.rowid
        WHERE notes_fts MATCH ?
        ORDER BY n.created_at DESC, n.rowid DESC
        LIMIT ?`,
    );
    this.listStmt = db.prepare(
      `SELECT id, created_at, updated_at, title, status, duration_ms
         FROM notes ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    );
    this.getStmt = db.prepare(`SELECT ${ALL_COLS} FROM notes WHERE id=?`);
    this.deleteStmt = db.prepare('DELETE FROM notes WHERE id=?');
    this.deleteAudioStmt = db.prepare(
      'UPDATE notes SET audio_path=NULL, updated_at=? WHERE id=?',
    );
  }

  create(input: { id: string; audioPath: string; durationMs: number }): void {
    const now = Date.now();
    this.createStmt.run(input.id, now, now, input.audioPath, input.durationMs);
  }

  updateStatus(id: string, status: NoteStatus, errorMessage?: string): void {
    this.updateStatusStmt.run(status, errorMessage ?? null, Date.now(), id);
  }

  setTranscript(id: string, transcript: string): void {
    this.setTranscriptStmt.run(transcript, Date.now(), id);
  }

  setMarkdown(id: string, markdown: string, title: string, modelUsed: string, provider: string): void {
    this.setMarkdownStmt.run(markdown, title, modelUsed, provider, Date.now(), id);
  }

  updateMarkdown(id: string, markdown: string, title: string): void {
    this.updateMarkdownStmt.run(markdown, title, Date.now(), id);
  }

  list(opts?: { search?: string; limit?: number }): NoteSummary[] {
    const limit = opts?.limit ?? 200;
    if (opts?.search && opts.search.trim().length > 0) {
      const rows = this.listSearchStmt.all(escapeFts(opts.search), limit) as NoteRow[];
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        title: r.title,
        status: r.status,
        durationMs: r.duration_ms,
      }));
    }
    const rows = this.listStmt.all(limit) as NoteRow[];
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      title: r.title,
      status: r.status,
      durationMs: r.duration_ms,
    }));
  }

  get(id: string): Note | undefined {
    const row = this.getStmt.get(id) as NoteRow | undefined;
    return row ? rowToNote(row) : undefined;
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }

  deleteAudio(id: string): void {
    this.deleteAudioStmt.run(Date.now(), id);
  }
}

function escapeFts(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');
}
