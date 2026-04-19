import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type Api, type NotesEvent } from '@shared/ipc';

const api: Api = {
  ping: () => ipcRenderer.invoke(IpcChannels.AppPing),
  notes: {
    create: (input) => ipcRenderer.invoke(IpcChannels.NotesCreate, input),
    list: (opts) => ipcRenderer.invoke(IpcChannels.NotesList, opts),
    get: (id) => ipcRenderer.invoke(IpcChannels.NotesGet, id),
    update: (id, markdown) => ipcRenderer.invoke(IpcChannels.NotesUpdate, { id, markdown }),
    delete: (id) => ipcRenderer.invoke(IpcChannels.NotesDelete, id),
    deleteAudio: (id) => ipcRenderer.invoke(IpcChannels.NotesDeleteAudio, id),
    retry: (id) => ipcRenderer.invoke(IpcChannels.NotesRetry, id),
    onEvent: (cb) => {
      const listener = (_: unknown, e: NotesEvent) => cb(e);
      ipcRenderer.on(IpcChannels.NotesEvent, listener);
      return () => ipcRenderer.off(IpcChannels.NotesEvent, listener);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.SettingsGet),
    set: (s) => ipcRenderer.invoke(IpcChannels.SettingsSet, s),
  },
  onHotkey: (cb) => {
    const listener = () => cb();
    ipcRenderer.on(IpcChannels.HotkeyPressed, listener);
    return () => ipcRenderer.off(IpcChannels.HotkeyPressed, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
