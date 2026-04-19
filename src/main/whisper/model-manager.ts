import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface ModelEntry {
  url: string;
  sha256: string;
}

export type ModelRegistry = Record<string, ModelEntry>;

type FetchLike = typeof fetch;

export interface WhisperModelManagerDeps {
  dir: string;
  registry: ModelRegistry;
  fetch?: FetchLike;
  onProgress?: (key: string, bytes: number) => void;
}

export class WhisperModelManager {
  private readonly dir: string;
  private readonly registry: ModelRegistry;
  private readonly fetch: FetchLike;
  private readonly onProgress?: (key: string, bytes: number) => void;

  constructor(deps: WhisperModelManagerDeps) {
    this.dir = deps.dir;
    this.registry = deps.registry;
    this.fetch = deps.fetch ?? fetch;
    this.onProgress = deps.onProgress;
  }

  async ensure(key: string): Promise<string> {
    const entry = this.registry[key];
    if (!entry) throw new Error(`Unknown model key: ${key}`);
    const finalPath = join(this.dir, `${key}.bin`);
    if (existsSync(finalPath) && (await fileSha256(finalPath)) === entry.sha256) return finalPath;
    await this.download(key, entry, finalPath);
    return finalPath;
  }

  private async download(key: string, entry: ModelEntry, dest: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${dest}.partial`;
    const res = await this.fetch(entry.url);
    if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
    if (!res.body) throw new Error('Model download produced no body');

    await new Promise<void>(async (resolve, reject) => {
      const out = createWriteStream(tmp);
      let bytes = 0;
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Buffer>) {
          bytes += chunk.length;
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          this.onProgress?.(key, bytes);
        }
        out.end(resolve);
      } catch (err) {
        out.destroy();
        reject(err);
      }
    });

    const got = await fileSha256(tmp);
    if (got !== entry.sha256) {
      await unlink(tmp).catch(() => {});
      throw new Error(`sha256 mismatch for ${key}: expected ${entry.sha256}, got ${got}`);
    }
    await rename(tmp, dest);
  }
}

function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}
