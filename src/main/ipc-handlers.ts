import { BrowserWindow, ipcMain } from 'electron';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { IpcChannels, type NotesEvent } from '@shared/ipc';
import type { Settings } from '@shared/types';
import { extractTitle } from '@shared/title';
import type { NoteStore } from './db/store';
import type { Pipeline } from './pipeline';
import type { SettingsStore } from './settings';

export interface IpcHandlerDeps {
  store: NoteStore;
  settings: SettingsStore;
  pipeline: Pipeline;
  audioDir: string;
  windows: () => BrowserWindow[];
}

// ---- Validation ------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hard caps on renderer-supplied payloads. The renderer is the only caller,
// but Electron IPC has no inherent shape or size guarantees, so we treat these
// as untrusted inputs.
const MAX_AUDIO_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_STRING_BYTES = 5 * 1024 * 1024; // 5 MB (markdown / title / search)
const MAX_SEARCH_BYTES = 4 * 1024; // 4 KB is plenty for a search box
const MAX_LIMIT = 1000;

export class IpcValidationError extends Error {
  readonly channel: string;
  constructor(channel: string, message: string) {
    super(`[${channel}] ${message}`);
    this.name = 'IpcValidationError';
    this.channel = channel;
  }
}

function assertUuid(channel: string, value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new IpcValidationError(channel, `${field} must be a UUID string`);
  }
  return value;
}

function assertString(channel: string, value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string') {
    throw new IpcValidationError(channel, `${field} must be a string`);
  }
  // `.length` is UTF-16 code units; bytes upper-bound is 3x (BMP) / 4x (astral).
  // Use byteLength for a precise check.
  const byteLen = Buffer.byteLength(value, 'utf8');
  if (byteLen > maxBytes) {
    throw new IpcValidationError(
      channel,
      `${field} exceeds max size (${byteLen} > ${maxBytes} bytes)`,
    );
  }
  return value;
}

function assertFiniteInt(channel: string, value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new IpcValidationError(channel, `${field} must be a finite integer`);
  }
  if (value < min || value > max) {
    throw new IpcValidationError(channel, `${field} out of range [${min}, ${max}]`);
  }
  return value;
}

function assertObject(channel: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcValidationError(channel, 'payload must be an object');
  }
  return value as Record<string, unknown>;
}

function assertAudioBuffer(channel: string, value: unknown): Buffer {
  // The structured clone algorithm delivers ArrayBuffer / typed-array / Buffer
  // on the receiving side. Accept each and normalise to Buffer.
  let buf: Buffer;
  if (value instanceof ArrayBuffer) {
    buf = Buffer.from(value);
  } else if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    buf = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  } else {
    throw new IpcValidationError(channel, 'audio must be an ArrayBuffer or typed array');
  }
  if (buf.byteLength === 0) {
    throw new IpcValidationError(channel, 'audio must not be empty');
  }
  if (buf.byteLength > MAX_AUDIO_BYTES) {
    throw new IpcValidationError(
      channel,
      `audio exceeds max size (${buf.byteLength} > ${MAX_AUDIO_BYTES} bytes)`,
    );
  }
  return buf;
}

function assertSettings(channel: string, value: unknown): Settings {
  const s = assertObject(channel, value);
  const provider = s['provider'];
  if (provider !== 'anthropic' && provider !== 'openrouter' && provider !== 'custom') {
    throw new IpcValidationError(channel, 'provider must be anthropic | openrouter | custom');
  }
  const apiKey = assertString(channel, s['apiKey'], 'apiKey', MAX_STRING_BYTES);
  const baseUrl = assertString(channel, s['baseUrl'], 'baseUrl', MAX_STRING_BYTES);
  const model = assertString(channel, s['model'], 'model', MAX_STRING_BYTES);
  if (typeof s['hotkeyEnabled'] !== 'boolean') {
    throw new IpcValidationError(channel, 'hotkeyEnabled must be boolean');
  }
  const hotkeyAccelerator = assertString(
    channel,
    s['hotkeyAccelerator'],
    'hotkeyAccelerator',
    MAX_STRING_BYTES,
  );
  if (typeof s['keepAudioDefault'] !== 'boolean') {
    throw new IpcValidationError(channel, 'keepAudioDefault must be boolean');
  }
  return {
    provider,
    apiKey,
    baseUrl,
    model,
    hotkeyEnabled: s['hotkeyEnabled'],
    hotkeyAccelerator,
    keepAudioDefault: s['keepAudioDefault'],
  };
}

/**
 * Defense in depth: verify a DB-supplied audio path stays inside `audioDir`.
 * Returns the resolved path on success, or null if the path escapes the dir
 * (in which case the caller should skip the unlink — the path is untrusted).
 */
function safeAudioPath(audioPath: string, audioDir: string): string | null {
  if (typeof audioPath !== 'string' || audioPath.length === 0) return null;
  if (!isAbsolute(audioPath)) return null;
  const resolvedDir = resolve(audioDir);
  const resolvedPath = resolve(audioPath);
  const rel = relative(resolvedDir, resolvedPath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return resolvedPath;
}

// ---- Handler registration --------------------------------------------------

export function registerIpcHandlers(deps: IpcHandlerDeps): {
  broadcastNotesEvent: (e: NotesEvent) => void;
} {
  const activeJobs = new Map<
    string,
    {
      controller: AbortController;
      done: Promise<void>;
    }
  >();

  const broadcastNotesEvent = (event: NotesEvent) => {
    for (const w of deps.windows()) w.webContents.send(IpcChannels.NotesEvent, event);
  };

  const startProcessing = (id: string): boolean => {
    if (activeJobs.has(id)) return false;

    const controller = new AbortController();
    const done = deps.pipeline
      .process(id, { signal: controller.signal })
      .catch(() => {})
      .finally(() => {
        if (activeJobs.get(id)?.done === done) activeJobs.delete(id);
      });

    activeJobs.set(id, { controller, done });
    return true;
  };

  const stopProcessing = async (id: string): Promise<void> => {
    const job = activeJobs.get(id);
    if (!job) return;
    job.controller.abort();
    await job.done;
  };

  ipcMain.handle(IpcChannels.AppPing, () => 'pong' as const);

  ipcMain.handle(IpcChannels.NotesCreate, async (_e, input: unknown) => {
    const channel = IpcChannels.NotesCreate;
    const obj = assertObject(channel, input);
    const audio = assertAudioBuffer(channel, obj['audio']);
    // durationMs sanity cap: 24h. Negative/NaN rejected.
    const durationMs = assertFiniteInt(channel, obj['durationMs'], 'durationMs', 0, 24 * 60 * 60 * 1000);

    const id = uuidv4();
    await mkdir(deps.audioDir, { recursive: true });
    const path = join(deps.audioDir, `${id}.webm`);
    await writeFile(path, audio);
    deps.store.create({ id, audioPath: path, durationMs });
    startProcessing(id);
    return { id };
  });

  ipcMain.handle(IpcChannels.NotesList, (_e, opts?: unknown) => {
    const channel = IpcChannels.NotesList;
    if (opts === undefined || opts === null) return deps.store.list();
    const o = assertObject(channel, opts);
    const validated: { search?: string; limit?: number } = {};
    if (o['search'] !== undefined) {
      validated.search = assertString(channel, o['search'], 'search', MAX_SEARCH_BYTES);
    }
    if (o['limit'] !== undefined) {
      validated.limit = assertFiniteInt(channel, o['limit'], 'limit', 1, MAX_LIMIT);
    }
    return deps.store.list(validated);
  });

  ipcMain.handle(IpcChannels.NotesGet, (_e, id: unknown) => {
    const validId = assertUuid(IpcChannels.NotesGet, id);
    return deps.store.get(validId) ?? null;
  });

  ipcMain.handle(IpcChannels.NotesUpdate, (_e, args: unknown) => {
    const channel = IpcChannels.NotesUpdate;
    const o = assertObject(channel, args);
    const id = assertUuid(channel, o['id']);
    const markdown = assertString(channel, o['markdown'], 'markdown', MAX_STRING_BYTES);
    const title = extractTitle(markdown);
    deps.store.updateMarkdown(id, markdown, title);
    broadcastNotesEvent({ type: 'note:updated', payload: { id } });
  });

  ipcMain.handle(IpcChannels.NotesDelete, async (_e, id: unknown) => {
    const validId = assertUuid(IpcChannels.NotesDelete, id);
    const note = deps.store.get(validId);
    await stopProcessing(validId);
    if (note?.audioPath) {
      const safe = safeAudioPath(note.audioPath, deps.audioDir);
      if (safe) await unlink(safe).catch(() => {});
    }
    deps.store.delete(validId);
    broadcastNotesEvent({ type: 'note:updated', payload: { id: validId } });
  });

  ipcMain.handle(IpcChannels.NotesDeleteAudio, async (_e, id: unknown) => {
    const validId = assertUuid(IpcChannels.NotesDeleteAudio, id);
    const note = deps.store.get(validId);
    await stopProcessing(validId);
    if (note?.audioPath) {
      const safe = safeAudioPath(note.audioPath, deps.audioDir);
      if (safe) await unlink(safe).catch(() => {});
    }
    deps.store.deleteAudio(validId);
    broadcastNotesEvent({ type: 'note:updated', payload: { id: validId } });
  });

  ipcMain.handle(IpcChannels.NotesRetry, async (_e, id: unknown) => {
    const validId = assertUuid(IpcChannels.NotesRetry, id);
    startProcessing(validId);
  });

  ipcMain.handle(IpcChannels.SettingsGet, () => deps.settings.read());
  ipcMain.handle(IpcChannels.SettingsSet, (_e, s: unknown) => {
    const validated = assertSettings(IpcChannels.SettingsSet, s);
    deps.settings.write(validated);
  });

  return { broadcastNotesEvent };
}
