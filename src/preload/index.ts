import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, type Api } from '@shared/ipc';

const api: Api = {
  ping: () => ipcRenderer.invoke(IpcChannels.Ping),
};

contextBridge.exposeInMainWorld('api', api);
