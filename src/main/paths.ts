import { app } from 'electron';
import { join } from 'node:path';

export function userDataPath(...segments: string[]): string {
  return join(app.getPath('userData'), ...segments);
}

export function resourcePath(...segments: string[]): string {
  if (app.isPackaged) return join(process.resourcesPath, ...segments);
  return join(__dirname, '..', '..', ...segments);
}

export function platformBinaryDir(): string {
  const platform = process.platform;
  const arch = process.arch;
  const map: Record<string, string> = {
    'darwin-arm64': 'mac-arm64',
    'darwin-x64': 'mac-x64',
    'win32-x64': 'win-x64',
    'linux-x64': 'linux-x64',
  };
  const key = `${platform}-${arch}`;
  const folder = map[key];
  if (!folder) throw new Error(`Unsupported platform: ${key}`);
  // In packaged builds, `extraResources` drops the tree under Contents/Resources/bin
  // so `resources/` is dev-only and must not be in the packaged path.
  if (app.isPackaged) return join(process.resourcesPath, 'bin', folder);
  return join(__dirname, '..', '..', 'resources', 'bin', folder);
}
