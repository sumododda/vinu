import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
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

async function createMainWindow(): Promise<BrowserWindow> {
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

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
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

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? cspDev : cspProd],
      },
    });
  });

  const services = await createServices(() => BrowserWindow.getAllWindows());
  await recoverInterrupted(services);

  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
