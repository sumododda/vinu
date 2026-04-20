import { app, BrowserWindow, globalShortcut, session } from 'electron';
import { join } from 'node:path';
import { formatBootError, renderBootHtml } from './boot-view';
import { createServices, type Services } from './services';

const isDev = !app.isPackaged;

const cspProd =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' https:; " +
  "img-src 'self' data: blob:; " +
  "media-src 'self' blob:; " +
  "font-src 'self' data:;";

const cspDev =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' https: ws: http://localhost:* ws://localhost:*; " +
  "img-src 'self' data: blob:; " +
  "media-src 'self' blob:; " +
  "font-src 'self' data:;";

let servicesReady: Services | null = null;
let servicesInitError: unknown = null;
let servicesPromise: Promise<Services> | null = null;

function createShellWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
}

async function loadRenderer(win: BrowserWindow): Promise<void> {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

async function recoverInterrupted(services: Services): Promise<void> {
  const interrupted = services.store
    .list({ limit: 1000 })
    .filter((n) => n.status === 'transcribing' || n.status === 'generating');
  for (const n of interrupted) {
    services.store.updateStatus(
      n.id,
      n.status === 'transcribing' ? 'transcription_failed' : 'generation_failed',
      'Interrupted by app restart',
    );
  }
}

async function loadBootView(win: BrowserWindow, state: Parameters<typeof renderBootHtml>[0]): Promise<void> {
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderBootHtml(state))}`);
}

function ensureServices(): Promise<Services> {
  if (servicesReady) return Promise.resolve(servicesReady);
  if (servicesPromise) return servicesPromise;

  servicesPromise = (async () => {
    try {
      const services = await createServices(() => BrowserWindow.getAllWindows());
      await recoverInterrupted(services);
      servicesReady = services;
      servicesInitError = null;
      return services;
    } catch (err) {
      servicesInitError = err;
      servicesPromise = null;
      throw err;
    }
  })();

  return servicesPromise;
}

async function syncWindowToAppState(win: BrowserWindow): Promise<void> {
  if (servicesReady) {
    await loadRenderer(win);
    return;
  }

  await loadBootView(win, { kind: 'loading' });

  try {
    await ensureServices();
    if (!win.isDestroyed()) await loadRenderer(win);
  } catch (err) {
    if (!win.isDestroyed()) {
      await loadBootView(win, { kind: 'error', message: formatBootError(err) });
    }
  }
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? cspDev : cspProd],
      },
    });
  });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextWindow = createShellWindow();
      await syncWindowToAppState(nextWindow);
    }
  });

  const win = createShellWindow();
  await syncWindowToAppState(win);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
