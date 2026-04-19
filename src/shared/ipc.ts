import type { Note, NoteSummary, NoteStatus, Settings } from './types';

export const IpcChannels = {
  AppPing: 'app:ping',
  NotesCreate: 'notes:create',
  NotesList: 'notes:list',
  NotesGet: 'notes:get',
  NotesUpdate: 'notes:update',
  NotesDelete: 'notes:delete',
  NotesDeleteAudio: 'notes:deleteAudio',
  NotesRetry: 'notes:retry',
  NotesEvent: 'notes:event',
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
    delete(id: string): Promise<void>;
    deleteAudio(id: string): Promise<void>;
    retry(id: string): Promise<void>;
    onEvent(cb: (e: NotesEvent) => void): () => void;
  };
  settings: {
    get(): Promise<Settings>;
    set(s: Settings): Promise<void>;
  };
  onHotkey(cb: () => void): () => void;
};

export type { Note, NoteSummary, NoteStatus, Settings };

declare global {
  interface Window {
    api: Api;
  }
}
