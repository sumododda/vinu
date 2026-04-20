import { BrowserWindow, ipcMain } from 'electron';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { IpcChannels, type NotesEvent } from '@shared/ipc';
import type { RendererSettings, Settings } from '@shared/types';
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
const MAX_TEXT_BYTES = 5 * 1024 * 1024; // settings / generic text
const MAX_MARKDOWN_BYTES = 25 * 1024 * 1024; // inline images can live in note bodies
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

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function assertBaseUrl(channel: string, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new IpcValidationError(channel, 'baseUrl must be a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new IpcValidationError(channel, 'baseUrl must use http: or https:');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local')) {
    throw new IpcValidationError(channel, 'baseUrl cannot target localhost or .local hosts');
  }
  if (/^169\.254\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) {
    throw new IpcValidationError(channel, 'baseUrl cannot target private IP ranges');
  }
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) {
    throw new IpcValidationError(channel, 'baseUrl cannot target private IP ranges');
  }
  return trimmed;
}

function assertSettings(channel: string, value: unknown, existing: Settings): Settings {
  const s = assertObject(channel, value);
  const provider = s['provider'];
  if (provider !== 'anthropic' && provider !== 'openrouter' && provider !== 'custom') {
    throw new IpcValidationError(channel, 'provider must be anthropic | openrouter | custom');
  }
  // Renderer sends an empty `apiKey` when the user didn't type a new one —
  // preserve what's already stored instead of wiping it.
  const apiKeyRaw = s['apiKey'];
  const apiKey =
    typeof apiKeyRaw === 'string' && apiKeyRaw.length > 0
      ? assertString(channel, apiKeyRaw, 'apiKey', MAX_TEXT_BYTES)
      : existing.apiKey;
  const rawBaseUrl = assertString(channel, s['baseUrl'], 'baseUrl', MAX_TEXT_BYTES);
  const baseUrl = assertBaseUrl(channel, rawBaseUrl);
  if (provider === 'custom' && !baseUrl) {
    throw new IpcValidationError(channel, 'custom provider requires a non-empty baseUrl');
  }
  const model = assertString(channel, s['model'], 'model', MAX_TEXT_BYTES);
  if (typeof s['hotkeyEnabled'] !== 'boolean') {
    throw new IpcValidationError(channel, 'hotkeyEnabled must be boolean');
  }
  const hotkeyAccelerator = assertString(
    channel,
    s['hotkeyAccelerator'],
    'hotkeyAccelerator',
    MAX_TEXT_BYTES,
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

  const startJob = (
    id: string,
    work: (opts: { signal?: AbortSignal }) => Promise<void>,
  ): boolean => {
    if (activeJobs.has(id)) return false;

    const controller = new AbortController();
    const done = Promise.resolve()
      .then(() => work({ signal: controller.signal }))
      .catch(() => {})
      .finally(() => {
        if (activeJobs.get(id)?.done === done) activeJobs.delete(id);
      });

    activeJobs.set(id, { controller, done });
    return true;
  };

  const startProcessing = (id: string): boolean =>
    startJob(id, (opts) => deps.pipeline.process(id, opts));

  const startRegeneration = (id: string): boolean =>
    startJob(id, (opts) => deps.pipeline.regenerate(id, opts));

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
    const markdown = assertString(channel, o['markdown'], 'markdown', MAX_MARKDOWN_BYTES);
    const title = extractTitle(markdown);
    deps.store.updateMarkdown(id, markdown, title);
    broadcastNotesEvent({ type: 'note:updated', payload: { id } });
  });

  ipcMain.handle(IpcChannels.NotesUpdateTranscript, (_e, args: unknown) => {
    const channel = IpcChannels.NotesUpdateTranscript;
    const o = assertObject(channel, args);
    const id = assertUuid(channel, o['id']);
    const transcript = assertString(channel, o['transcript'], 'transcript', MAX_TEXT_BYTES);
    deps.store.setTranscript(id, transcript);
    broadcastNotesEvent({ type: 'note:updated', payload: { id } });
  });

  ipcMain.handle(IpcChannels.NotesRegenerate, async (_e, id: unknown) => {
    const validId = assertUuid(IpcChannels.NotesRegenerate, id);
    startRegeneration(validId);
  });

  ipcMain.handle(IpcChannels.NotesSetFolder, (_e, args: unknown) => {
    const channel = IpcChannels.NotesSetFolder;
    const o = assertObject(channel, args);
    const id = assertUuid(channel, o['id']);
    const folderIdValue = o['folderId'];
    const folderId =
      folderIdValue == null ? null : assertUuid(channel, folderIdValue, 'folderId');
    deps.store.setFolder(id, folderId);
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

  ipcMain.handle(IpcChannels.FoldersList, () => deps.store.listFolders());

  ipcMain.handle(IpcChannels.FoldersCreate, (_e, input: unknown) => {
    const channel = IpcChannels.FoldersCreate;
    const o = assertObject(channel, input);
    const name = assertString(channel, o['name'], 'name', MAX_TEXT_BYTES).trim();
    const parentValue = o['parentId'];
    const parentId = parentValue == null ? null : assertUuid(channel, parentValue, 'parentId');
    if (!name) throw new IpcValidationError(channel, 'name must not be empty');
    return deps.store.createFolder({ id: uuidv4(), name, parentId });
  });

  ipcMain.handle(IpcChannels.FoldersRename, (_e, input: unknown) => {
    const channel = IpcChannels.FoldersRename;
    const o = assertObject(channel, input);
    const id = assertUuid(channel, o['id']);
    const name = assertString(channel, o['name'], 'name', MAX_TEXT_BYTES).trim();
    if (!name) throw new IpcValidationError(channel, 'name must not be empty');
    return deps.store.renameFolder(id, name);
  });

  ipcMain.handle(IpcChannels.FoldersSetParent, (_e, input: unknown) => {
    const channel = IpcChannels.FoldersSetParent;
    const o = assertObject(channel, input);
    const id = assertUuid(channel, o['id']);
    const parentValue = o['parentId'];
    const parentId = parentValue == null ? null : assertUuid(channel, parentValue, 'parentId');
    return deps.store.setFolderParent(id, parentId);
  });

  ipcMain.handle(IpcChannels.FoldersDelete, (_e, input: unknown) => {
    const channel = IpcChannels.FoldersDelete;
    const o = assertObject(channel, input);
    const id = assertUuid(channel, o['id']);
    const destValue = o['notesDestination'];
    if (destValue !== 'parent' && destValue !== 'ungrouped') {
      throw new IpcValidationError(channel, 'notesDestination must be "parent" or "ungrouped"');
    }
    deps.store.deleteFolder(id, destValue);
    broadcastNotesEvent({ type: 'note:updated', payload: { id: '' } });
  });

  ipcMain.handle(IpcChannels.SettingsGet, (): RendererSettings => {
    const stored = deps.settings.read();
    const { apiKey, ...rest } = stored;
    return { ...rest, hasApiKey: apiKey.length > 0 };
  });
  ipcMain.handle(IpcChannels.SettingsSet, (_e, s: unknown) => {
    const existing = deps.settings.read();
    const validated = assertSettings(IpcChannels.SettingsSet, s, existing);
    deps.settings.write(validated);
  });

  return { broadcastNotesEvent };
}
