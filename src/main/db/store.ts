import type Database from 'better-sqlite3';
import { stripNoteMarkupForSearch } from '@shared/note-content';
import type { Folder, Note, NoteStatus, NoteSummary } from '@shared/types';

export type { Folder, Note, NoteStatus, NoteSummary };

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
  folder_id: string | null;
  folder_name: string | null;
}

interface FolderRow {
  id: string;
  created_at: number;
  updated_at: number;
  name: string;
}

const NOTE_COLS = `n.id, n.created_at, n.updated_at, n.title, n.markdown, n.transcript,
  n.audio_path, n.duration_ms, n.status, n.error_message, n.model_used, n.provider,
  n.folder_id, folders.name AS folder_name`;

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
    folderId: r.folder_id,
    folderName: r.folder_name,
  };
}

function rowToSummary(r: NoteRow): NoteSummary {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    title: r.title,
    status: r.status,
    durationMs: r.duration_ms,
    folderId: r.folder_id,
    folderName: r.folder_name,
  };
}

function rowToFolder(r: FolderRow): Folder {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    name: r.name,
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
  private readonly setFolderStmt: Database.Statement;
  private readonly listSearchStmt: Database.Statement;
  private readonly listStmt: Database.Statement;
  private readonly getStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;
  private readonly deleteAudioStmt: Database.Statement;
  private readonly listFoldersStmt: Database.Statement;
  private readonly getFolderByNameStmt: Database.Statement;
  private readonly createFolderStmt: Database.Statement;

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
          SET markdown=?, search_text=?, title=?, model_used=?, provider=?, status='ready',
              error_message=NULL, updated_at=?
        WHERE id=?`,
    );
    this.updateMarkdownStmt = db.prepare(
      'UPDATE notes SET markdown=?, search_text=?, title=?, updated_at=? WHERE id=?',
    );
    this.setFolderStmt = db.prepare(
      'UPDATE notes SET folder_id=?, updated_at=? WHERE id=?',
    );
    this.listSearchStmt = db.prepare(
      `SELECT n.id, n.created_at, n.updated_at, n.title, n.status, n.duration_ms, n.folder_id,
              folders.name AS folder_name
         FROM notes n
         JOIN notes_fts fts ON fts.rowid = n.rowid
         LEFT JOIN folders ON folders.id = n.folder_id
        WHERE notes_fts MATCH ?
        ORDER BY n.created_at DESC, n.rowid DESC
        LIMIT ?`,
    );
    this.listStmt = db.prepare(
      `SELECT n.id, n.created_at, n.updated_at, n.title, n.status, n.duration_ms, n.folder_id,
              folders.name AS folder_name
         FROM notes n
         LEFT JOIN folders ON folders.id = n.folder_id
        ORDER BY n.created_at DESC, n.rowid DESC
        LIMIT ?`,
    );
    this.getStmt = db.prepare(
      `SELECT ${NOTE_COLS}
         FROM notes n
         LEFT JOIN folders ON folders.id = n.folder_id
        WHERE n.id=?`,
    );
    this.deleteStmt = db.prepare('DELETE FROM notes WHERE id=?');
    this.deleteAudioStmt = db.prepare(
      'UPDATE notes SET audio_path=NULL, updated_at=? WHERE id=?',
    );
    this.listFoldersStmt = db.prepare(
      'SELECT id, created_at, updated_at, name FROM folders ORDER BY lower(name) ASC, created_at ASC',
    );
    this.getFolderByNameStmt = db.prepare(
      'SELECT id, created_at, updated_at, name FROM folders WHERE name = ? COLLATE NOCASE',
    );
    this.createFolderStmt = db.prepare(
      'INSERT INTO folders (id, created_at, updated_at, name) VALUES (?, ?, ?, ?)',
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
    this.setMarkdownStmt.run(
      markdown,
      stripNoteMarkupForSearch(markdown),
      title,
      modelUsed,
      provider,
      Date.now(),
      id,
    );
  }

  updateMarkdown(id: string, markdown: string, title: string): void {
    this.updateMarkdownStmt.run(
      markdown,
      stripNoteMarkupForSearch(markdown),
      title,
      Date.now(),
      id,
    );
  }

  setFolder(id: string, folderId: string | null): void {
    this.setFolderStmt.run(folderId, Date.now(), id);
  }

  list(opts?: { search?: string; limit?: number }): NoteSummary[] {
    const limit = opts?.limit ?? 200;
    if (opts?.search && opts.search.trim().length > 0) {
      const rows = this.listSearchStmt.all(escapeFts(opts.search), limit) as NoteRow[];
      return rows.map(rowToSummary);
    }
    const rows = this.listStmt.all(limit) as NoteRow[];
    return rows.map(rowToSummary);
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

  listFolders(): Folder[] {
    const rows = this.listFoldersStmt.all() as FolderRow[];
    return rows.map(rowToFolder);
  }

  createFolder(input: { id: string; name: string }): Folder {
    const existing = this.getFolderByNameStmt.get(input.name) as FolderRow | undefined;
    if (existing) return rowToFolder(existing);

    const now = Date.now();
    this.createFolderStmt.run(input.id, now, now, input.name);
    return {
      id: input.id,
      createdAt: now,
      updatedAt: now,
      name: input.name,
    };
  }
}

function escapeFts(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');
}
