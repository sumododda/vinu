import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '@shared/ipc';

const ipcHandlers = new Map<string, (...args: any[]) => any>();

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      ipcHandlers.set(channel, handler);
    }),
  },
}));

const unlink = vi.fn().mockResolvedValue(undefined);
const mkdir = vi.fn().mockResolvedValue(undefined);
const writeFile = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  mkdir,
  unlink,
  writeFile,
}));

vi.mock('uuid', () => ({
  v4: () => 'note-1',
}));

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    mkdir.mockClear();
    unlink.mockClear();
    writeFile.mockClear();
    vi.resetModules();
  });

  it('does not start a duplicate retry while a note is already processing', async () => {
    const { registerIpcHandlers } = await import('./ipc-handlers');

    let resolveProcess!: () => void;
    const process = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveProcess = resolve;
        }),
    );

    registerIpcHandlers({
      store: {} as any,
      settings: {} as any,
      pipeline: { process } as any,
      audioDir: '/tmp/audio',
      windows: () => [],
    });

    const retry = ipcHandlers.get(IpcChannels.NotesRetry)!;
    await retry({}, '11111111-1111-4111-8111-111111111111');
    await retry({}, '11111111-1111-4111-8111-111111111111');

    expect(process).toHaveBeenCalledTimes(1);

    resolveProcess();
  });

  it('aborts and waits for active work before deleting a note', async () => {
    const { registerIpcHandlers } = await import('./ipc-handlers');

    const store = {
      delete: vi.fn(),
      get: vi.fn().mockReturnValue({ audioPath: '/tmp/audio/n-1.webm' }),
    };

    let finishProcess!: () => void;
    let capturedSignal: AbortSignal | undefined;
    const process = vi.fn(
      (_id: string, opts?: { signal?: AbortSignal }) =>
        new Promise<void>((resolve) => {
          capturedSignal = opts?.signal;
          finishProcess = resolve;
        }),
    );

    registerIpcHandlers({
      store: store as any,
      settings: {} as any,
      pipeline: { process } as any,
      audioDir: '/tmp/audio',
      windows: () => [],
    });

    const retry = ipcHandlers.get(IpcChannels.NotesRetry)!;
    await retry({}, '11111111-1111-4111-8111-111111111111');

    const del = ipcHandlers.get(IpcChannels.NotesDelete)!({}, '11111111-1111-4111-8111-111111111111');
    expect(capturedSignal?.aborted).toBe(true);

    await Promise.resolve();
    expect(store.delete).not.toHaveBeenCalled();

    finishProcess();
    await del;

    expect(unlink).toHaveBeenCalledWith('/tmp/audio/n-1.webm');
    expect(store.delete).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('broadcasts note update events after direct note mutations', async () => {
    const { registerIpcHandlers } = await import('./ipc-handlers');

    const send = vi.fn();
    const store = {
      updateMarkdown: vi.fn(),
      delete: vi.fn(),
      deleteAudio: vi.fn(),
      get: vi.fn().mockReturnValue({ audioPath: null }),
    };

    registerIpcHandlers({
      store: store as any,
      settings: {} as any,
      pipeline: { process: vi.fn() } as any,
      audioDir: '/tmp/audio',
      windows: () => [{ webContents: { send } }] as any,
    });

    await ipcHandlers.get(IpcChannels.NotesUpdate)!({}, { id: '11111111-1111-4111-8111-111111111111', markdown: '# Title' });
    await ipcHandlers.get(IpcChannels.NotesDeleteAudio)!({}, '11111111-1111-4111-8111-111111111111');
    await ipcHandlers.get(IpcChannels.NotesDelete)!({}, '11111111-1111-4111-8111-111111111111');

    expect(send).toHaveBeenCalledWith(IpcChannels.NotesEvent, {
      type: 'note:updated',
      payload: { id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
