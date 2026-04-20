import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const readyCallbacks: Array<() => unknown> = [];
const allWindows: BrowserWindowMock[] = [];
const onHeadersReceived = vi.fn();
const appOn = vi.fn();
const appEventHandlers = new Map<string, (...args: any[]) => unknown>();

class BrowserWindowMock {
  public readonly loadFile = vi.fn().mockResolvedValue(undefined);
  public readonly loadURL = vi.fn().mockResolvedValue(undefined);
  private destroyed = false;

  constructor() {
    allWindows.push(this);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
  }

  static getAllWindows(): BrowserWindowMock[] {
    return allWindows.filter((w) => !w.isDestroyed());
  }
}

const createServices = vi.fn();

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    whenReady: () => ({
      then: (cb: () => unknown) => {
        readyCallbacks.push(cb);
      },
    }),
    on: (event: string, handler: (...args: any[]) => unknown) => {
      appOn(event, handler);
      appEventHandlers.set(event, handler);
    },
    quit: vi.fn(),
  },
  BrowserWindow: BrowserWindowMock,
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived,
      },
    },
  },
}));

vi.mock('./services', () => ({
  createServices,
}));

describe('main boot flow', () => {
  beforeEach(() => {
    readyCallbacks.length = 0;
    allWindows.length = 0;
    appEventHandlers.clear();
    onHeadersReceived.mockClear();
    appOn.mockClear();
    createServices.mockReset();
    Reflect.deleteProperty(process.env, 'ELECTRON_RENDERER_URL');
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading page before services are ready, then loads the renderer', async () => {
    let resolveServices!: (value: any) => void;
    createServices.mockReturnValue(
      new Promise((resolve) => {
        resolveServices = resolve;
      }),
    );

    await import('./index');
    const booting = Promise.resolve(readyCallbacks[0]!());
    await Promise.resolve();

    expect(allWindows).toHaveLength(1);
    const win = allWindows[0]!;
    expect(win.loadURL).toHaveBeenCalledWith(
      expect.stringContaining('data:text/html;charset=utf-8,'),
    );
    expect(win.loadFile).not.toHaveBeenCalled();

    resolveServices({
      store: { list: () => [] },
      settings: {},
      pipeline: {},
      audioDir: '/tmp/audio',
    });
    await Promise.resolve();
    await Promise.resolve();
    await booting;

    expect(win.loadFile).toHaveBeenCalledWith(
      expect.stringContaining(join('src', 'renderer', 'index.html')),
    );
  });

  it('shows an error page if service initialization fails', async () => {
    createServices.mockRejectedValue(new Error('model download failed'));

    await import('./index');
    await readyCallbacks[0]!();

    const win = allWindows[0]!;
    const finalUrl = win.loadURL.mock.calls.at(-1)?.[0] as string;
    expect(finalUrl).toContain('data:text/html;charset=utf-8,');
    expect(decodeURIComponent(finalUrl.split(',')[1]!)).toContain('model download failed');
    expect(win.loadFile).not.toHaveBeenCalled();
  });

  it('retries service initialization on a later activate after an initial failure', async () => {
    createServices
      .mockRejectedValueOnce(new Error('transient boot failure'))
      .mockResolvedValueOnce({
        store: { list: () => [] },
        settings: {},
        pipeline: {},
        audioDir: '/tmp/audio',
      });

    await import('./index');
    await readyCallbacks[0]!();

    const firstWindow = allWindows[0]!;
    let firstUrl = firstWindow.loadURL.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(firstUrl.split(',')[1]!)).toContain('transient boot failure');
    expect(firstWindow.loadFile).not.toHaveBeenCalled();

    firstWindow.destroy();

    const activate = appEventHandlers.get('activate');
    expect(activate).toBeTypeOf('function');
    await activate!();

    expect(createServices).toHaveBeenCalledTimes(2);
    expect(allWindows).toHaveLength(2);

    const secondWindow = allWindows[1]!;
    firstUrl = secondWindow.loadURL.mock.calls[0]?.[0] as string;
    expect(firstUrl).toContain('data:text/html;charset=utf-8,');
    expect(secondWindow.loadFile).toHaveBeenCalledWith(
      expect.stringContaining(join('src', 'renderer', 'index.html')),
    );
  });
});
