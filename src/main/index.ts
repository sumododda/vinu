import { app, BrowserWindow, globalShortcut, session, shell } from 'electron';
import { join } from 'node:path';
import { URL } from 'node:url';
import { formatBootError, renderBootHtml } from './boot-view';
import { createServices, type Services } from './services';

const isDev = !app.isPackaged;

// Allowed outbound API hosts for `connect-src`. We hard-allow the two
// known provider hosts; custom user-configured `baseUrl` values are not
// threaded here (would require settings access before CSP is installed),
// so users pointing at a custom baseUrl will currently be blocked.
// TODO: plumb SettingsStore to refresh CSP when baseUrl changes.
const API_HOSTS = "https://api.anthropic.com https://api.openai.com";

// NOTE: `'unsafe-inline'` in `style-src` is required because (a) the boot
// view embeds a <style> block and (b) the React renderer uses inline
// `style={{...}}` props in several components.
const cspProd =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  `connect-src 'self' ${API_HOSTS}; ` +
  "img-src 'self' data: blob:; " +
  "media-src 'self' blob:; " +
  "font-src 'self' data:;";

const cspDev =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; " +
  `connect-src 'self' ${API_HOSTS} ws: http://localhost:* ws://localhost:*; ` +
  "img-src 'self' data: blob:; " +
  "media-src 'self' blob:; " +
  "font-src 'self' data:;";

let servicesReady: Services | null = null;
let servicesInitError: unknown = null;
let servicesPromise: Promise<Services> | null = null;

function createShellWindow(): BrowserWindow {
  const win = new BrowserWindow({
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
  applyNavigationLockdown(win);
  return win;
}

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function isAllowedInAppNavigation(rawUrl: string): boolean {
  // Allow the dev renderer URL during development and the boot-view data: URL.
  if (rawUrl.startsWith('data:text/html')) return true;
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    if (rawUrl.startsWith(process.env['ELECTRON_RENDERER_URL'])) return true;
  }
  try {
    const u = new URL(rawUrl);
    // Packaged renderer is loaded via `loadFile` which maps to file://.
    if (u.protocol === 'file:') return true;
  } catch {
    // fall through to deny
  }
  return false;
}

function applyNavigationLockdown(win: BrowserWindow): void {
  const wc = win.webContents;
  if (!wc) return; // defensive: some test environments stub BrowserWindow without webContents.

  wc.on('will-navigate', (event, url) => {
    if (isAllowedInAppNavigation(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  if (typeof wc.setWindowOpenHandler === 'function') {
    wc.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
      // Never spawn new BrowserWindows (which would inherit the preload).
      return { action: 'deny' };
    });
  }
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
    let services: Services;
    try {
      services = await createServices(() => BrowserWindow.getAllWindows());
    } catch (err) {
      // Pre-init failure (before IPC handlers were registered): safe to
      // allow a future retry by resetting the promise.
      servicesInitError = err;
      servicesPromise = null;
      throw err;
    }

    // Once createServices() resolves, IPC handlers are already registered
    // with ipcMain. If a post-init step (like recovery) throws, we must
    // NOT null out servicesPromise — retrying would re-run registerIpcHandlers
    // and crash on duplicate `ipcMain.handle` registration. Keep the
    // resolved services around and surface the error without reset.
    try {
      await recoverInterrupted(services);
    } catch (err) {
      servicesInitError = err;
      servicesReady = services;
      return services;
    }

    servicesReady = services;
    servicesInitError = null;
    return services;
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

  // Permission handler: allow only microphone ("media"); deny everything else.
  if (typeof session.defaultSession.setPermissionRequestHandler === 'function') {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media');
    });
  }

  // Global lockdown for any future web-contents (e.g., webview tags).
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (e, url) => {
      if (isAllowedInAppNavigation(url)) return;
      e.preventDefault();
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
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
