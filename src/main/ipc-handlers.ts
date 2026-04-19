import { BrowserWindow, ipcMain } from 'electron';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { IpcChannels, type NotesEvent } from '@shared/ipc';
import type { NoteStore } from './db/store';
import type { Pipeline } from './pipeline';
import type { SettingsStore } from './settings';

export interface IpcHandlerDeps {
  store: NoteStore;
  settings: SettingsStore;
  pipeline: Pipeline;
  audioDir: string;
  windows: () => BrowserWindow[];
}

export function registerIpcHandlers(deps: IpcHandlerDeps): {
  broadcastNotesEvent: (e: NotesEvent) => void;
} {
  const broadcastNotesEvent = (event: NotesEvent) => {
    for (const w of deps.windows()) w.webContents.send(IpcChannels.NotesEvent, event);
  };

  ipcMain.handle(IpcChannels.AppPing, () => 'pong' as const);

  ipcMain.handle(IpcChannels.NotesCreate, async (_e, input: { audio: ArrayBuffer; durationMs: number }) => {
    const id = uuidv4();
    await mkdir(deps.audioDir, { recursive: true });
    const path = join(deps.audioDir, `${id}.webm`);
    await writeFile(path, Buffer.from(input.audio));
    deps.store.create({ id, audioPath: path, durationMs: input.durationMs });
    void deps.pipeline.process(id);
    return { id };
  });

  ipcMain.handle(IpcChannels.NotesList, (_e, opts?: { search?: string; limit?: number }) =>
    deps.store.list(opts),
  );

  ipcMain.handle(IpcChannels.NotesGet, (_e, id: string) => deps.store.get(id) ?? null);

  ipcMain.handle(IpcChannels.NotesUpdate, (_e, args: { id: string; markdown: string }) => {
    const title = (args.markdown.match(/^#\s+(.+?)\s*$/m)?.[1] ?? 'Untitled').trim();
    deps.store.updateMarkdown(args.id, args.markdown, title);
  });

  ipcMain.handle(IpcChannels.NotesDelete, async (_e, id: string) => {
    const note = deps.store.get(id);
    if (note?.audioPath) await unlink(note.audioPath).catch(() => {});
    deps.store.delete(id);
  });

  ipcMain.handle(IpcChannels.NotesDeleteAudio, async (_e, id: string) => {
    const note = deps.store.get(id);
    if (note?.audioPath) await unlink(note.audioPath).catch(() => {});
    deps.store.deleteAudio(id);
  });

  ipcMain.handle(IpcChannels.NotesRetry, async (_e, id: string) => {
    void deps.pipeline.process(id);
  });

  ipcMain.handle(IpcChannels.SettingsGet, () => deps.settings.read());
  ipcMain.handle(IpcChannels.SettingsSet, (_e, s) => deps.settings.write(s));

  return { broadcastNotesEvent };
}
