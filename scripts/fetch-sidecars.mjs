import { mkdir, chmod, stat, rm, rename, readFile } from 'node:fs/promises';
import { existsSync, createWriteStream, createReadStream, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, 'sidecar-manifest.json');
const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

const WHISPER_VERSION = manifest.whisperBuild.version;
const WHISPER_REPO = manifest.whisperBuild.repo;

const key = `${process.platform}-${process.arch}`;
const ffmpegEntry = manifest.ffmpeg[key];
const whisperPrebuilt = manifest.whisper[key] ?? null;
const whisperBuild = manifest.whisperBuild.platforms.includes(key);

if (!ffmpegEntry && !whisperPrebuilt && !whisperBuild) {
  console.warn(`fetch-sidecars: no binaries configured for ${key}; skipping`);
  process.exit(0);
}

const folderByKey = {
  'darwin-arm64': 'mac-arm64',
  'darwin-x64': 'mac-x64',
  'win32-x64': 'win-x64',
  'linux-x64': 'linux-x64',
};
const folder = folderByKey[key];
if (!folder) {
  console.warn(`fetch-sidecars: no output folder configured for ${key}; skipping`);
  process.exit(0);
}

const baseDir = join(process.cwd(), 'resources', 'bin', folder);
await mkdir(baseDir, { recursive: true });

const ext = process.platform === 'win32' ? '.exe' : '';

if (ffmpegEntry) await fetchFfmpeg(ffmpegEntry);
await fetchWhisper();

async function fetchFfmpeg(entry) {
  const dest = join(baseDir, `ffmpeg${ext}`);
  if (existsSync(dest) && (await stat(dest)).size > 0) {
    console.log(`fetch-sidecars: ffmpeg already present (skipping)`);
    return;
  }

  const tmp = join(tmpdir(), `vinu-ffmpeg-${randomUUID()}`);
  await mkdir(tmp, { recursive: true });

  console.log(`fetch-sidecars: downloading ffmpeg ${entry.version} from ${entry.url}`);

  if (entry.archiveType === 'binary') {
    await downloadAndVerify(entry.url, dest, entry.sha256, 'ffmpeg');
    if (process.platform !== 'win32') await chmod(dest, 0o755);
    console.log(`fetch-sidecars: ffmpeg ready at ${dest}`);
    return;
  }

  const archive = `${tmp}.${entry.archiveType === 'tarxz' ? 'tar.xz' : 'zip'}`;
  await downloadAndVerify(entry.url, archive, entry.sha256, 'ffmpeg');

  if (entry.archiveType === 'zip') {
    runOrThrow('unzip', ['-o', '-q', archive, '-d', tmp]);
  } else if (entry.archiveType === 'tarxz') {
    runOrThrow('tar', ['xf', archive, '-C', tmp]);
  } else {
    throw new Error(`fetch-sidecars: unsupported archive type ${entry.archiveType}`);
  }

  const found = findFile(tmp, entry.binaryName);
  if (!found) throw new Error(`ffmpeg binary (${entry.binaryName}) not found after extraction`);
  await rename(found, dest);

  if (process.platform !== 'win32') await chmod(dest, 0o755);
  await rm(tmp, { recursive: true, force: true });
  try {
    await rm(archive, { force: true });
  } catch {}
  console.log(`fetch-sidecars: ffmpeg ready at ${dest}`);
}

async function fetchWhisper() {
  const dest = join(baseDir, `whisper${ext}`);
  if (existsSync(dest) && (await stat(dest)).size > 0) {
    console.log(`fetch-sidecars: whisper already present (skipping)`);
    return;
  }

  if (whisperBuild) {
    await buildWhisperFromSource(dest);
    return;
  }

  if (whisperPrebuilt) {
    const entry = whisperPrebuilt;
    const tmp = join(tmpdir(), `vinu-whisper-${randomUUID()}`);
    const archive = `${tmp}.zip`;
    await mkdir(tmp, { recursive: true });

    console.log(`fetch-sidecars: downloading whisper ${entry.version} from ${entry.url}`);
    await downloadAndVerify(entry.url, archive, entry.sha256, 'whisper');

    runOrThrow('unzip', ['-o', '-q', archive, '-d', tmp]);
    const found = findFile(tmp, entry.binaryName);
    if (!found) throw new Error(`whisper binary (${entry.binaryName}) not found after extraction`);
    await rename(found, dest);

    if (process.platform !== 'win32') await chmod(dest, 0o755);
    await rm(tmp, { recursive: true, force: true });
    try {
      await rm(archive, { force: true });
    } catch {}
    console.log(`fetch-sidecars: whisper ready at ${dest}`);
    return;
  }

  console.warn(`fetch-sidecars: no whisper binary available for ${key}; build from source manually`);
}

async function buildWhisperFromSource(dest) {
  console.log(`fetch-sidecars: building whisper ${WHISPER_VERSION} from source...`);
  const tmp = join(tmpdir(), `vinu-whisper-build-${randomUUID()}`);
  await mkdir(tmp, { recursive: true });

  runOrThrow('git', ['clone', '--depth', '1', '--branch', WHISPER_VERSION, WHISPER_REPO, tmp]);
  // BUILD_SHARED_LIBS=OFF: produce a self-contained whisper-cli with no @rpath
  //   references to the temporary CMake build tree (which is deleted at the end).
  // GGML_METAL_EMBED_LIBRARY=ON: embed Metal shaders into the binary so we don't
  //   need to ship a separate ggml-metal.metal next to the executable.
  // WHISPER_BUILD_TESTS=OFF: skip tests we don't need.
  const cmakeFlags = [
    '-B', 'build',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DWHISPER_BUILD_TESTS=OFF',
  ];
  if (process.platform === 'darwin') {
    cmakeFlags.push('-DGGML_METAL_EMBED_LIBRARY=ON');
  }
  runOrThrow('cmake', cmakeFlags, { cwd: tmp });

  const jobs = String(detectCpuCount());
  runOrThrow('cmake', ['--build', 'build', '--config', 'Release', '-j', jobs], { cwd: tmp });

  const built = findFile(join(tmp, 'build', 'bin'), 'whisper-cli');
  if (!built) throw new Error(`whisper-cli binary not found after build`);
  await rename(built, dest);
  if (process.platform !== 'win32') await chmod(dest, 0o755);
  await rm(tmp, { recursive: true, force: true });
  console.log(`fetch-sidecars: whisper built and ready at ${dest}`);
}

function detectCpuCount() {
  try {
    const n = spawnSync('sysctl', ['-n', 'hw.ncpu'], { encoding: 'utf8', shell: false });
    if (n.status === 0 && n.stdout.trim()) return parseInt(n.stdout.trim(), 10) || 4;
  } catch {}
  try {
    const n = spawnSync('nproc', [], { encoding: 'utf8', shell: false });
    if (n.status === 0 && n.stdout.trim()) return parseInt(n.stdout.trim(), 10) || 4;
  } catch {}
  return 4;
}

function runOrThrow(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { shell: false, stdio: 'inherit', ...opts });
  if (res.error) throw res.error;
  if (typeof res.status === 'number' && res.status !== 0) {
    throw new Error(`${cmd} exited with code ${res.status}`);
  }
  if (res.signal) {
    throw new Error(`${cmd} killed by signal ${res.signal}`);
  }
}

async function downloadAndVerify(url, dest, expectedSha256, label) {
  if (existsSync(dest) && (await stat(dest)).size > 0) {
    const existing = await fileSha256(dest);
    if (existing === expectedSha256) {
      console.log(`fetch-sidecars: ${label} archive already downloaded and verified`);
      return;
    }
    await rm(dest, { force: true });
  }
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${url}`);
  await pipeline(res.body, createWriteStream(dest));

  const actual = await fileSha256(dest);
  console.log(`fetch-sidecars: verifying ${label} sha256...`);
  console.log(`  expected: ${expectedSha256}`);
  console.log(`  actual:   ${actual}`);
  if (actual !== expectedSha256) {
    await rm(dest, { force: true }).catch(() => {});
    throw new Error(
      `fetch-sidecars: sha256 mismatch for ${label} (${url})\n  expected: ${expectedSha256}\n  actual:   ${actual}\nRefusing to proceed — a compromised mirror or MITM could be shipping tampered binaries.`,
    );
  }
  console.log(`fetch-sidecars: ${label} sha256 OK`);
}

function fileSha256(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

function findFile(dir, name) {
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name === name) {
      return join(entry.parentPath || dirname(entry.path), entry.name);
    }
  }
  return null;
}
