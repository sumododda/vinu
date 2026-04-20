import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
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
  /** Max number of download attempts. Defaults to 3. */
  maxAttempts?: number;
  /** Base delay for exponential backoff (ms). Defaults to 1000 (1s, 2s, 4s). */
  backoffBaseMs?: number;
  /** Sleep hook — injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface EnsureOptions {
  signal?: AbortSignal;
}

export class AbortError extends Error {
  constructor(msg = 'Aborted') {
    super(msg);
    this.name = 'AbortError';
  }
}

export class HashMismatchError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'HashMismatchError';
  }
}

// Errors considered transient — we retry these. Everything else (4xx, hash
// mismatch, abort) is fatal and propagates immediately.
const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  if (e.code && TRANSIENT_NET_CODES.has(e.code)) return true;
  if (e.cause && e.cause.code && TRANSIENT_NET_CODES.has(e.cause.code)) return true;
  // Premature close / socket hang up from undici.
  if (e.message && /premature close|socket hang up|terminated|network/i.test(e.message)) {
    return true;
  }
  return false;
}

export class WhisperModelManager {
  private readonly dir: string;
  private readonly registry: ModelRegistry;
  private readonly fetch: FetchLike;
  private readonly onProgress?: (key: string, bytes: number) => void;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: WhisperModelManagerDeps) {
    this.dir = deps.dir;
    this.registry = deps.registry;
    this.fetch = deps.fetch ?? fetch;
    this.onProgress = deps.onProgress;
    this.maxAttempts = deps.maxAttempts ?? 3;
    this.backoffBaseMs = deps.backoffBaseMs ?? 1000;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async ensure(key: string, opts: EnsureOptions = {}): Promise<string> {
    const entry = this.registry[key];
    if (!entry) throw new Error(`Unknown model key: ${key}`);
    const finalPath = join(this.dir, `${key}.bin`);
    if (existsSync(finalPath) && (await fileSha256(finalPath)) === entry.sha256) return finalPath;
    await this.download(key, entry, finalPath, opts.signal);
    return finalPath;
  }

  private async download(
    key: string,
    entry: ModelEntry,
    dest: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${dest}.part`;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) throw new AbortError();
      try {
        await this.downloadOnce(key, entry, tmp, signal);
        // Success: verify hash once, at the end, by streaming .part.
        const got = await fileSha256(tmp);
        if (got !== entry.sha256) {
          // Bad hash: registry is wrong or file corrupted beyond resume.
          // Don't retry — delete and throw.
          await unlink(tmp).catch(() => {});
          throw new HashMismatchError(
            `sha256 mismatch for ${key}: expected ${entry.sha256}, got ${got}`,
          );
        }
        await rename(tmp, dest);
        return;
      } catch (err) {
        lastErr = err;
        if (isAbortError(err)) {
          // Leave .part in place for later resume.
          throw err instanceof AbortError ? err : new AbortError();
        }
        if (err instanceof HashMismatchError) {
          // Non-retryable.
          throw err;
        }
        if (!isTransientError(err)) {
          // HTTP 4xx, unknown errors, etc. — don't retry.
          throw err;
        }
        if (attempt >= this.maxAttempts) break;
        const delay = this.backoffBaseMs * 2 ** (attempt - 1);
        // eslint-disable-next-line no-console
        console.warn(
          `[whisper model-manager] transient download error for ${key} ` +
            `(attempt ${attempt}/${this.maxAttempts}): ${(err as Error)?.message ?? err}. ` +
            `Retrying in ${delay}ms.`,
        );
        await this.sleep(delay);
      }
    }
    throw lastErr;
  }

  /**
   * One HTTP attempt. Streams into `tmp`, resuming from its current size if
   * it already exists. Throws on network error, non-ok status, or abort.
   */
  private async downloadOnce(
    key: string,
    entry: ModelEntry,
    tmp: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const existingBytes = existsSync(tmp) ? statSync(tmp).size : 0;

    const headers: Record<string, string> = {};
    if (existingBytes > 0) {
      headers['Range'] = `bytes=${existingBytes}-`;
    }

    const res = await this.fetch(entry.url, { headers, signal });

    // HTTP-level failure. 4xx is fatal; 5xx we classify as transient by
    // wrapping in a synthetic transient error.
    if (!res.ok && res.status !== 206) {
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Model download failed: ${res.status}`);
      }
      const e = new Error(`Model download failed: ${res.status}`);
      (e as { code?: string }).code = 'UND_ERR_SOCKET';
      throw e;
    }
    if (!res.body) throw new Error('Model download produced no body');

    // Decide: resume or full restart?
    // - 206 Partial Content: server honored our Range; append to .part.
    // - 200 OK with a Range request: server ignored Range; truncate and
    //   start over.
    // - 200 OK without a Range request (existingBytes === 0): normal case.
    const append = res.status === 206 && existingBytes > 0;
    let startBytes = append ? existingBytes : 0;

    if (!append && existingBytes > 0) {
      // Server ignored Range — start fresh.
      await unlink(tmp).catch(() => {});
      startBytes = 0;
    }

    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmp, { flags: append ? 'a' : 'w' });
      let settled = false;
      let bytes = startBytes;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        // End (not destroy) so buffered bytes flush to disk — that way
        // .part survives with what we successfully received, and a later
        // call can Range-resume from where we stopped.
        out.end(() => {
          reject(new AbortError());
        });
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const cleanup = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      out.on('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });

      // Emit initial progress so resume callers see the pre-existing bytes.
      this.onProgress?.(key, bytes);

      (async () => {
        try {
          for await (const chunk of res.body as unknown as AsyncIterable<Buffer>) {
            if (settled) return;
            if (signal?.aborted) {
              onAbort();
              return;
            }
            bytes += chunk.length;
            if (!out.write(chunk)) {
              await new Promise<void>((r) => out.once('drain', () => r()));
            }
            this.onProgress?.(key, bytes);
          }
          if (settled) return;
          out.end(() => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          });
        } catch (err) {
          if (settled) return;
          settled = true;
          cleanup();
          out.destroy();
          reject(err);
        }
      })();
    });
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
