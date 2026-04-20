import { mkdir, chmod, stat } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const TARGETS = {
  'darwin-arm64': {
    folder: 'mac-arm64',
    whisperUrl: 'REPLACE_WITH_VERIFIED_WHISPER_RELEASE_URL_MAC_ARM64',
    ffmpegUrl: 'REPLACE_WITH_VERIFIED_FFMPEG_STATIC_URL_MAC_ARM64',
  },
  'darwin-x64': {
    folder: 'mac-x64',
    whisperUrl: 'REPLACE_WITH_VERIFIED_WHISPER_RELEASE_URL_MAC_X64',
    ffmpegUrl: 'REPLACE_WITH_VERIFIED_FFMPEG_STATIC_URL_MAC_X64',
  },
  'win32-x64': {
    folder: 'win-x64',
    whisperUrl: 'REPLACE_WITH_VERIFIED_WHISPER_RELEASE_URL_WIN_X64',
    ffmpegUrl: 'REPLACE_WITH_VERIFIED_FFMPEG_STATIC_URL_WIN_X64',
  },
  'linux-x64': {
    folder: 'linux-x64',
    whisperUrl: 'REPLACE_WITH_VERIFIED_WHISPER_RELEASE_URL_LINUX_X64',
    ffmpegUrl: 'REPLACE_WITH_VERIFIED_FFMPEG_STATIC_URL_LINUX_X64',
  },
};

const key = `${process.platform}-${process.arch}`;
const target = TARGETS[key];
if (!target) {
  console.warn(`fetch-sidecars: no binaries configured for ${key}; skipping`);
  process.exit(0);
}

const baseDir = join(process.cwd(), 'resources', 'bin', target.folder);
await mkdir(baseDir, { recursive: true });

const ext = process.platform === 'win32' ? '.exe' : '';
await Promise.all([
  download(target.whisperUrl, join(baseDir, `whisper${ext}`)),
  download(target.ffmpegUrl, join(baseDir, `ffmpeg${ext}`)),
]);
console.log(`fetch-sidecars: ready in ${baseDir}`);

async function download(url, dest) {
  if (url.startsWith('REPLACE_')) {
    console.warn(`fetch-sidecars: ${dest} URL not configured; skipping`);
    return;
  }
  if (existsSync(dest) && (await stat(dest)).size > 0) return;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await pipeline(res.body, createWriteStream(dest));
  if (process.platform !== 'win32') await chmod(dest, 0o755);
}
