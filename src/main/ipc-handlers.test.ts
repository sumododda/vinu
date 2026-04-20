import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
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
      pipeline: { process, regenerate: vi.fn() } as any,
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
      pipeline: { process, regenerate: vi.fn() } as any,
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

    // path.join for cross-platform — on Windows the handler resolves to
    // D:\tmp\audio\n-1.webm via path.resolve for the defense-in-depth guard.
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining(join('audio', 'n-1.webm')));
    expect(store.delete).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('broadcasts note update events after direct note mutations', async () => {
    const { registerIpcHandlers } = await import('./ipc-handlers');

    const send = vi.fn();
    const store = {
      updateMarkdown: vi.fn(),
      setTranscript: vi.fn(),
      createFolder: vi.fn(),
      delete: vi.fn(),
      deleteAudio: vi.fn(),
      get: vi.fn().mockReturnValue({ audioPath: null }),
    };
    const regenerate = vi.fn();

    registerIpcHandlers({
      store: store as any,
      settings: {} as any,
      pipeline: { process: vi.fn(), regenerate } as any,
      audioDir: '/tmp/audio',
      windows: () => [{ webContents: { send } }] as any,
    });

    await ipcHandlers.get(IpcChannels.NotesUpdate)!({}, { id: '11111111-1111-4111-8111-111111111111', markdown: '# Title' });
    await ipcHandlers.get(IpcChannels.NotesUpdateTranscript)!({}, { id: '11111111-1111-4111-8111-111111111111', transcript: 'Fixed transcript' });
    await ipcHandlers.get(IpcChannels.NotesRegenerate)!({}, '11111111-1111-4111-8111-111111111111');
    await ipcHandlers.get(IpcChannels.NotesDeleteAudio)!({}, '11111111-1111-4111-8111-111111111111');
    await ipcHandlers.get(IpcChannels.NotesDelete)!({}, '11111111-1111-4111-8111-111111111111');

    expect(store.setTranscript).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'Fixed transcript');
    expect(regenerate).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', expect.anything());
    expect(send).toHaveBeenCalledWith(IpcChannels.NotesEvent, {
      type: 'note:updated',
      payload: { id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('redacts the api key from SettingsGet and signals hasApiKey', async () => {
    const { registerIpcHandlers } = await import('./ipc-handlers');
    const settingsRead = vi.fn().mockReturnValue({
      provider: 'anthropic',
      apiKey: 'sk-very-secret',
      baseUrl: '',
      model: 'claude-opus-4-7',
      hotkeyEnabled: false,
      hotkeyAccelerator: 'CommandOrControl+Shift+N',
      keepAudioDefault: true,
    });

    registerIpcHandlers({
      store: {} as any,
      settings: { read: settingsRead, write: vi.fn() } as any,
      pipeline: { process: vi.fn(), regenerate: vi.fn() } as any,
      audioDir: '/tmp/audio',
      windows: () => [],
    });

    const result = await ipcHandlers.get(IpcChannels.SettingsGet)!();
    expect(result).not.toHaveProperty('apiKey');
    expect(result).toMatchObject({ provider: 'anthropic', hasApiKey: true });
    expect(JSON.stringify(result)).not.toContain('sk-very-secret');
  });

  it('preserves the stored api key when SettingsSet receives an empty apiKey', async () => {
    const { registerIpcHandlers } = await import('./ipc-handlers');
    const existing = {
      provider: 'anthropic',
      apiKey: 'sk-existing',
      baseUrl: '',
      model: 'claude-opus-4-7',
      hotkeyEnabled: false,
      hotkeyAccelerator: 'CommandOrControl+Shift+N',
      keepAudioDefault: true,
    };
    const write = vi.fn();

    registerIpcHandlers({
      store: {} as any,
      settings: { read: vi.fn().mockReturnValue(existing), write } as any,
      pipeline: { process: vi.fn(), regenerate: vi.fn() } as any,
      audioDir: '/tmp/audio',
      windows: () => [],
    });

    await ipcHandlers.get(IpcChannels.SettingsSet)!(
      {},
      {
        provider: 'anthropic',
        apiKey: '',
        baseUrl: '',
        model: 'claude-opus-4-7',
        hotkeyEnabled: false,
        hotkeyAccelerator: 'CommandOrControl+Shift+N',
        keepAudioDefault: true,
      },
    );

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-existing' }));
  });

  it('rejects baseUrl pointing at localhost or file://', async () => {
    const { registerIpcHandlers } = await import('./ipc-handlers');
    const existing = {
      provider: 'anthropic',
      apiKey: 'sk-existing',
      baseUrl: '',
      model: 'claude-opus-4-7',
      hotkeyEnabled: false,
      hotkeyAccelerator: 'CommandOrControl+Shift+N',
      keepAudioDefault: true,
    };

    registerIpcHandlers({
      store: {} as any,
      settings: { read: vi.fn().mockReturnValue(existing), write: vi.fn() } as any,
      pipeline: { process: vi.fn(), regenerate: vi.fn() } as any,
      audioDir: '/tmp/audio',
      windows: () => [],
    });

    const base = {
      provider: 'custom',
      apiKey: 'sk-x',
      model: 'local',
      hotkeyEnabled: false,
      hotkeyAccelerator: 'CommandOrControl+Shift+N',
      keepAudioDefault: true,
    };
    const handler = ipcHandlers.get(IpcChannels.SettingsSet)!;

    expect(() => handler({}, { ...base, baseUrl: 'http://localhost:8080' })).toThrow(/localhost/);
    expect(() => handler({}, { ...base, baseUrl: 'http://127.0.0.1:1' })).toThrow(/localhost/);
    expect(() => handler({}, { ...base, baseUrl: 'file:///etc/passwd' })).toThrow(/http:/);
    expect(() => handler({}, { ...base, baseUrl: 'http://192.168.1.5' })).toThrow(/private/);
  });

  it('requires custom provider to have a baseUrl', async () => {
    const { registerIpcHandlers } = await import('./ipc-handlers');
    const existing = {
      provider: 'anthropic',
      apiKey: 'sk-existing',
      baseUrl: '',
      model: 'claude-opus-4-7',
      hotkeyEnabled: false,
      hotkeyAccelerator: 'CommandOrControl+Shift+N',
      keepAudioDefault: true,
    };

    registerIpcHandlers({
      store: {} as any,
      settings: { read: vi.fn().mockReturnValue(existing), write: vi.fn() } as any,
      pipeline: { process: vi.fn(), regenerate: vi.fn() } as any,
      audioDir: '/tmp/audio',
      windows: () => [],
    });

    expect(() =>
      ipcHandlers.get(IpcChannels.SettingsSet)!({}, {
        provider: 'custom',
        apiKey: 'sk-x',
        baseUrl: '',
        model: 'local',
        hotkeyEnabled: false,
        hotkeyAccelerator: 'CommandOrControl+Shift+N',
        keepAudioDefault: true,
      }),
    ).toThrow(/custom provider requires/);
  });
});
