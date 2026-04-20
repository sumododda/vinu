import { mkdir, chmod, stat, rm, rename } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const WHISPER_VERSION = 'v1.8.4';
const WHISPER_REPO = 'https://github.com/ggml-org/whisper.cpp.git';

const TARGETS = {
  'darwin-arm64': {
    folder: 'mac-arm64',
    ffmpegUrl: 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
    ffmpegType: 'zip',
    ffmpegBinary: 'ffmpeg',
    whisperBuild: true,
  },
  'darwin-x64': {
    folder: 'mac-x64',
    ffmpegUrl: 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
    ffmpegType: 'zip',
    ffmpegBinary: 'ffmpeg',
    whisperBuild: true,
  },
  'win32-x64': {
    folder: 'win-x64',
    whisperUrl: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`,
    whisperType: 'zip',
    whisperBinary: 'main.exe',
    ffmpegUrl: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    ffmpegType: 'zip',
    ffmpegBinary: 'ffmpeg.exe',
    whisperBuild: false,
  },
  'linux-x64': {
    folder: 'linux-x64',
    ffmpegUrl: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    ffmpegType: 'tarxz',
    ffmpegBinary: 'ffmpeg',
    whisperBuild: true,
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

await fetchFfmpeg();
await fetchWhisper();

async function fetchFfmpeg() {
  const dest = join(baseDir, `ffmpeg${ext}`);
  if (existsSync(dest) && (await stat(dest)).size > 0) {
    console.log(`fetch-sidecars: ffmpeg already present`);
    return;
  }

  const tmp = join(tmpdir(), `vinu-ffmpeg-${randomUUID()}`);
  const archive = `${tmp}.${target.ffmpegType === 'tarxz' ? 'tar.xz' : 'zip'}`;

  console.log(`fetch-sidecars: downloading ffmpeg from ${target.ffmpegUrl}`);
  await download(target.ffmpegUrl, archive);

  if (target.ffmpegType === 'zip') {
    execSync(`unzip -o -j "${archive}" "${target.ffmpegBinary}" -d "${tmp}"`, { stdio: 'inherit' });
    await rename(join(tmp, target.ffmpegBinary), dest);
  } else {
    execSync(`tar xf "${archive}" -C "${tmp}" --wildcards "*/${target.ffmpegBinary}"`, { stdio: 'inherit' });
    const found = findFile(tmp, target.ffmpegBinary);
    if (!found) throw new Error(`ffmpeg binary not found after extraction`);
    await rename(found, dest);
  }

  if (process.platform !== 'win32') await chmod(dest, 0o755);
  await rm(tmp, { recursive: true, force: true });
  try { await rm(archive, { force: true }); } catch {}
  console.log(`fetch-sidecars: ffmpeg ready`);
}

async function fetchWhisper() {
  const dest = join(baseDir, `whisper${ext}`);
  if (existsSync(dest) && (await stat(dest)).size > 0) {
    console.log(`fetch-sidecars: whisper already present`);
    return;
  }

  if (target.whisperBuild) {
    await buildWhisper(dest);
  } else if (target.whisperUrl) {
    const tmp = join(tmpdir(), `vinu-whisper-${randomUUID()}`);
    const archive = `${tmp}.zip`;

    console.log(`fetch-sidecars: downloading whisper from ${target.whisperUrl}`);
    await download(target.whisperUrl, archive);

    execSync(`unzip -o -j "${archive}" "${target.whisperBinary}" -d "${tmp}"`, { stdio: 'inherit' });
    await rename(join(tmp, target.whisperBinary), dest);

    if (process.platform !== 'win32') await chmod(dest, 0o755);
    await rm(tmp, { recursive: true, force: true });
    try { await rm(archive, { force: true }); } catch {}
    console.log(`fetch-sidecars: whisper ready`);
  } else {
    console.warn(`fetch-sidecars: no whisper binary available for ${key}; build from source manually`);
  }
}

async function buildWhisper(dest) {
  console.log(`fetch-sidecars: building whisper ${WHISPER_VERSION} from source...`);
  const tmp = join(tmpdir(), `vinu-whisper-build-${randomUUID()}`);
  execSync(`git clone --depth 1 --branch ${WHISPER_VERSION} ${WHISPER_REPO} "${tmp}"`, { stdio: 'inherit' });
  execSync(`cmake -B build -DCMAKE_BUILD_TYPE=Release`, { cwd: tmp, stdio: 'inherit' });
  execSync(`cmake --build build --config Release -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)`, { cwd: tmp, stdio: 'inherit' });

  const built = findFile(join(tmp, 'build', 'bin'), 'whisper-cli');
  if (!built) throw new Error(`whisper-cli binary not found after build`);
  await rename(built, dest);
  if (process.platform !== 'win32') await chmod(dest, 0o755);
  await rm(tmp, { recursive: true, force: true });
  console.log(`fetch-sidecars: whisper built and ready`);
}

async function download(url, dest) {
  if (existsSync(dest) && (await stat(dest)).size > 0) return;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await pipeline(res.body, createWriteStream(dest));
}

function findFile(dir, name) {
  const { readdirSync } = require('node:fs');
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile && entry.name === name) return join(entry.parentPath || dirname(entry.path), entry.name);
  }
  return null;
}
