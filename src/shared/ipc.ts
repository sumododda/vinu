import type { Folder, Note, NoteSummary, NoteStatus, Settings } from './types';

export const IpcChannels = {
  AppPing: 'app:ping',
  NotesCreate: 'notes:create',
  NotesList: 'notes:list',
  NotesGet: 'notes:get',
  NotesUpdate: 'notes:update',
  NotesUpdateTranscript: 'notes:updateTranscript',
  NotesRegenerate: 'notes:regenerate',
  NotesSetFolder: 'notes:setFolder',
  NotesDelete: 'notes:delete',
  NotesDeleteAudio: 'notes:deleteAudio',
  NotesRetry: 'notes:retry',
  NotesEvent: 'notes:event',
  FoldersList: 'folders:list',
  FoldersCreate: 'folders:create',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  HotkeyPressed: 'hotkey:pressed',
} as const;

export interface NotesEvent {
  type: 'note:streaming' | 'note:updated' | 'note:failed';
  payload: {
    id: string;
    markdown?: string;
  };
}

export type Api = {
  ping(): Promise<'pong'>;
  notes: {
    create(input: { audio: ArrayBuffer; durationMs: number }): Promise<{ id: string }>;
    list(opts?: { search?: string; limit?: number }): Promise<NoteSummary[]>;
    get(id: string): Promise<Note | null>;
    update(id: string, markdown: string): Promise<void>;
    updateTranscript(id: string, transcript: string): Promise<void>;
    regenerate(id: string): Promise<void>;
    setFolder(id: string, folderId: string | null): Promise<void>;
    delete(id: string): Promise<void>;
    deleteAudio(id: string): Promise<void>;
    retry(id: string): Promise<void>;
    onEvent(cb: (e: NotesEvent) => void): () => void;
  };
  folders: {
    list(): Promise<Folder[]>;
    create(name: string, parentId?: string | null): Promise<Folder>;
  };
  settings: {
    get(): Promise<Settings>;
    set(s: Settings): Promise<void>;
  };
  onHotkey(cb: () => void): () => void;
};

export type { Folder, Note, NoteSummary, NoteStatus, Settings };

declare global {
  interface Window {
    api: Api;
  }
}
