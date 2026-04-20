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
  parent_id: string | null;
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
    parentId: r.parent_id,
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
  private readonly getFolderStmt: Database.Statement;
  private readonly renameFolderStmt: Database.Statement;
  private readonly setFolderParentStmt: Database.Statement;
  private readonly deleteFolderStmt: Database.Statement;
  private readonly moveNotesFromFolderStmt: Database.Statement;
  private readonly moveChildFoldersStmt: Database.Statement;

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
      `SELECT id, created_at, updated_at, name, parent_id
         FROM folders
        ORDER BY COALESCE(parent_id, ''), lower(name) ASC, created_at ASC`,
    );
    this.getFolderByNameStmt = db.prepare(
      `SELECT id, created_at, updated_at, name, parent_id
         FROM folders
        WHERE name = ? COLLATE NOCASE
          AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)`,
    );
    this.createFolderStmt = db.prepare(
      'INSERT INTO folders (id, created_at, updated_at, name, parent_id) VALUES (?, ?, ?, ?, ?)',
    );
    this.getFolderStmt = db.prepare(
      `SELECT id, created_at, updated_at, name, parent_id
         FROM folders
        WHERE id = ?`,
    );
    this.renameFolderStmt = db.prepare(
      'UPDATE folders SET name=?, updated_at=? WHERE id=?',
    );
    this.setFolderParentStmt = db.prepare(
      'UPDATE folders SET parent_id=?, updated_at=? WHERE id=?',
    );
    this.deleteFolderStmt = db.prepare('DELETE FROM folders WHERE id=?');
    this.moveNotesFromFolderStmt = db.prepare(
      'UPDATE notes SET folder_id=?, updated_at=? WHERE folder_id=?',
    );
    this.moveChildFoldersStmt = db.prepare(
      'UPDATE folders SET parent_id=?, updated_at=? WHERE parent_id=?',
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

  createFolder(input: { id: string; name: string; parentId?: string | null }): Folder {
    const parentId = input.parentId ?? null;
    const existing = this.getFolderByNameStmt.get(input.name, parentId, parentId) as
      | FolderRow
      | undefined;
    if (existing) return rowToFolder(existing);

    const now = Date.now();
    this.createFolderStmt.run(input.id, now, now, input.name, parentId);
    return {
      id: input.id,
      createdAt: now,
      updatedAt: now,
      name: input.name,
      parentId,
    };
  }

  getFolder(id: string): Folder | undefined {
    const row = this.getFolderStmt.get(id) as FolderRow | undefined;
    return row ? rowToFolder(row) : undefined;
  }

  renameFolder(id: string, name: string): Folder {
    const folder = this.getFolder(id);
    if (!folder) throw new Error('Folder not found');
    if (folder.name === name) return folder;
    const duplicate = this.getFolderByNameStmt.get(name, folder.parentId, folder.parentId) as
      | FolderRow
      | undefined;
    if (duplicate && duplicate.id !== id) {
      throw new Error('A folder with that name already exists in this location');
    }
    this.renameFolderStmt.run(name, Date.now(), id);
    return { ...folder, name, updatedAt: Date.now() };
  }

  setFolderParent(id: string, parentId: string | null): Folder {
    const folder = this.getFolder(id);
    if (!folder) throw new Error('Folder not found');
    if (parentId === id) throw new Error('A folder cannot be its own parent');
    if (parentId && this.isDescendant(parentId, id)) {
      throw new Error('Cannot move a folder into one of its descendants');
    }
    if ((folder.parentId ?? null) === (parentId ?? null)) return folder;
    const duplicate = this.getFolderByNameStmt.get(folder.name, parentId, parentId) as
      | FolderRow
      | undefined;
    if (duplicate && duplicate.id !== id) {
      throw new Error('A folder with that name already exists in the target location');
    }
    this.setFolderParentStmt.run(parentId ?? null, Date.now(), id);
    return { ...folder, parentId, updatedAt: Date.now() };
  }

  deleteFolder(id: string, notesDestination: 'parent' | 'ungrouped'): void {
    const folder = this.getFolder(id);
    if (!folder) return;
    const now = Date.now();
    const target = notesDestination === 'parent' ? folder.parentId ?? null : null;
    this.moveNotesFromFolderStmt.run(target, now, id);
    this.moveChildFoldersStmt.run(folder.parentId ?? null, now, id);
    this.deleteFolderStmt.run(id);
  }

  private isDescendant(candidateId: string, ancestorId: string): boolean {
    const seen = new Set<string>();
    let current: string | null = candidateId;
    while (current) {
      if (seen.has(current)) return false;
      seen.add(current);
      if (current === ancestorId) return true;
      const row = this.getFolderStmt.get(current) as FolderRow | undefined;
      if (!row) return false;
      current = row.parent_id;
    }
    return false;
  }
}

function escapeFts(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');
}
