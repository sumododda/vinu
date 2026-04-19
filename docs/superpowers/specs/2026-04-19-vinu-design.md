---
title: vinu — Design Spec
date: 2026-04-19
status: draft
---

# vinu — Design Spec

## Summary

A cross-platform desktop notetaking app. User presses a button (or a global hotkey), speaks, and stops. The app transcribes the audio locally using `whisper.cpp` and turns the transcript into well-structured, readable notes using a cloud LLM. Notes are saved locally, browsable as a chronological list with full-text search, and editable after generation.

Stack: **Electron + React + TypeScript**, `electron-vite` build, `electron-builder` packaging, `better-sqlite3` storage. Whisper ships as a per-OS sidecar binary; models download on first run.

## Goals

- Frictionless voice capture — idea to saved note in seconds, triggerable from anywhere on the desktop.
- Transcripts stay on-device.
- Notes are readable by a future-me: title, headings, bullets, the author's voice preserved.
- Works on macOS, Windows, and Linux from a single codebase.
- Provider-agnostic LLM — user can point at Anthropic (default), OpenRouter, or any OpenAI-compatible base URL.
- No legacy dependencies — every library referenced is verified current as of 2026-04.

## Non-goals (v1)

- Real-time streaming transcription while recording. Record-then-transcribe is enough.
- Cloud sync, multi-device, sharing, or collaboration.
- Folders / tags / manual organization. Chronological list + search is the organization.
- Mobile apps.
- Auto-updates (defer to `electron-updater` in a later version).
- Code signing / notarization beyond what's needed for local-use builds.
- Speaker diarization, multi-language UI, or custom fine-tuned Whisper models.

## High-level architecture

Three layers with a clean, testable boundary between each:

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer process (React + TypeScript, Vite)                 │
│  - All UI: record button, notes list, note editor, settings │
│  - Mic capture via navigator.mediaDevices.getUserMedia      │
│  - Communicates with main via typed IPC (preload bridge)    │
│  - No direct FS, network, or native access                  │
└───────────────────────────────┬─────────────────────────────┘
                                │ typed IPC (contextBridge)
┌───────────────────────────────┴─────────────────────────────┐
│ Main process (Electron / Node, TypeScript)                  │
│  - IPC handlers (thin; delegate to services)                │
│  - WhisperRunner — spawns sidecar, parses JSON              │
│  - AudioPreprocessor — remuxes recording to 16kHz mono WAV  │
│  - LLMClient (interface) + AnthropicClient/OpenAICompat     │
│  - NoteStore — SQLite via better-sqlite3                    │
│  - SettingsStore — encrypted via Electron safeStorage       │
│  - HotkeyManager — optional global accelerator              │
└───────────────────────────────┬─────────────────────────────┘
                                │ spawn / filesystem / HTTPS
┌───────────────────────────────┴─────────────────────────────┐
│ Bundled sidecars + on-disk state                            │
│  - resources/bin/<platform>/whisper                         │
│  - resources/bin/<platform>/ffmpeg                          │
│  - userData/app.db (SQLite)                                 │
│  - userData/audio/<note-uuid>.webm                          │
│  - userData/models/ggml-base.en.bin (downloaded 1st run)    │
└─────────────────────────────────────────────────────────────┘
```

Renderer is strictly sandboxed: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. A narrow `preload.ts` exposes a typed API via `contextBridge`. This is the modern Electron security posture and also makes main-process code trivially unit-testable.

## Components

Each component has one clear purpose, a documented interface, and depends only on what it needs. All main-process services are plain classes with constructor-injected dependencies — no singletons, no global state, easy to fake in tests.

### Renderer (`src/renderer/`)

- `App.tsx` — routing between list, detail/editor, settings.
- `NotesList` — chronological list with search input; subscribes to `notes:changed` events.
- `NoteDetail` — renders markdown, toggles to an editor (textarea or a light markdown editor — `@uiw/react-md-editor` or similar) for edits. Debounced save on change.
- `Recorder` — owns the `MediaRecorder` lifecycle. On stop, posts the audio `Blob` to main and navigates to the new note's detail page where streaming LLM output lands in real time.
- `Settings` — provider picker, API key, base URL, model, hotkey. Persists via IPC.

State: React Query (or a small Zustand store) reading from an IPC-backed repository. No direct DB access in the renderer.

### `WhisperRunner` (main)

Interface:
```ts
interface WhisperRunner {
  transcribe(wavPath: string, opts?: { language?: string }): Promise<TranscriptResult>;
}

interface TranscriptResult {
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  durationMs: number;
}
```

Implementation: spawns the sidecar (`resources/bin/<platform>/whisper`) with `--output-json-full` (or current equivalent — verified against the upstream CLI at build time), reads JSON from stdout, parses into `TranscriptResult`. Streams stderr into the app log. Cancellable via an `AbortSignal`.

### `AudioPreprocessor` (main)

Remuxes the renderer's WebM/Opus blob to 16 kHz mono PCM WAV using the bundled `ffmpeg` sidecar. Single method: `preprocess(inputPath: string): Promise<string /* wavPath */>`. Writes to a scratch path under `userData/tmp/`; cleans up after success.

### `LLMClient` (main)

Interface:
```ts
interface LLMClient {
  streamNotes(
    transcript: string,
    opts: { signal?: AbortSignal },
  ): AsyncIterable<NoteChunk>; // yields { delta: string } until done
}
```

Two implementations, chosen by the configured provider:

- **`AnthropicClient`** — uses `@anthropic-ai/sdk`'s `messages.stream` to get native features (prompt caching on the system prompt, proper streaming, real error shapes). Used when provider = `anthropic`.
- **`OpenAICompatClient`** — uses `openai` SDK with a configurable `baseURL` and `apiKey`, `stream: true`. Used for `openrouter` and `custom`.

Both use the **same fixed system prompt** (stored in `src/main/llm/prompts.ts`) and the same transcript-shaped user message. The system prompt asks the model to: produce a short title (first line as `# H1`), use headings and bullets where the content warrants, preserve the author's voice, never invent facts, and include an "Open questions" section only if the transcript actually contains them.

Model name comes from settings; defaults per provider:
- `anthropic` → `claude-opus-4-7`
- `openrouter` → `anthropic/claude-opus-4-7`
- `custom` → user-provided (no default)

### `NoteStore` (main)

Thin repository over `better-sqlite3`:

```ts
interface NoteStore {
  create(input: { id: string; audioPath: string; durationMs: number }): void;
  updateStatus(id: string, status: NoteStatus, error?: string): void;
  setTranscript(id: string, transcript: string): void;
  setMarkdown(id: string, markdown: string, title: string, modelUsed: string, provider: string): void;
  updateMarkdown(id: string, markdown: string, title: string): void; // user edits
  list(opts?: { search?: string; limit?: number; cursor?: string }): NoteSummary[];
  get(id: string): Note | undefined;
  delete(id: string): void;
  deleteAudio(id: string): void;
}
```

All methods synchronous (better-sqlite3 is). Schema in the next section.

### `SettingsStore` (main)

Persists settings to the `settings` table. API key is encrypted via Electron's `safeStorage` before being written; decrypted only when a request is being prepared. Never logged.

### `HotkeyManager` (main)

Registers a global `Accelerator` (default off, user-configurable). Toggling it emits `hotkey:pressed` on the IPC event channel; the renderer's `Recorder` starts/stops accordingly. If another app has already registered the same accelerator, registration returns false and settings surfaces the conflict.

## Data flow — record to saved note

1. User triggers recording (in-app button or global hotkey event).
2. Renderer's `Recorder` calls `getUserMedia({ audio: true })`, pipes to `MediaRecorder` with `mimeType: 'audio/webm;codecs=opus'`.
3. User triggers stop. Renderer concatenates chunks into a Blob, transfers it to main as an `ArrayBuffer` via IPC: `ipcRenderer.invoke('notes:create', { audio: arrayBuffer, durationMs })`.
4. Main writes `userData/audio/<uuid>.webm`. `NoteStore.create` inserts the row with `status='transcribing'`. IPC response: `{ id }`.
5. Renderer navigates to `/notes/<id>`; subscribes to `note:updated/<id>` events.
6. Main kicks off the pipeline asynchronously:
   - `AudioPreprocessor.preprocess` → wav path.
   - `WhisperRunner.transcribe` → `TranscriptResult`.
   - `NoteStore.setTranscript` + `updateStatus('generating')` + emit event.
   - `LLMClient.streamNotes(transcript)` → for each chunk, append to an in-memory buffer; every N ms emit `note:streaming/<id>` with the cumulative markdown so far.
   - On stream end: parse H1 as title; `NoteStore.setMarkdown`; `updateStatus('ready')`; emit `note:updated/<id>`.
7. If editing: renderer debounces keystrokes (~500ms) and calls `notes:update` with the new markdown. Main parses the first H1 as the new title.

## Storage schema

SQLite at `userData/app.db`, one writer (main), WAL mode on.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE notes (
  id           TEXT PRIMARY KEY,         -- uuid v4
  created_at   INTEGER NOT NULL,         -- epoch ms
  updated_at   INTEGER NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  markdown     TEXT NOT NULL DEFAULT '',
  transcript   TEXT NOT NULL DEFAULT '',
  audio_path   TEXT,                     -- null after audio deleted
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL CHECK (status IN (
                 'transcribing','generating','ready',
                 'transcription_failed','generation_failed','pending_network')),
  error_message TEXT,
  model_used   TEXT,
  provider     TEXT
);

CREATE INDEX notes_created_at_idx ON notes (created_at DESC);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, markdown, transcript,
  content='notes', content_rowid='rowid',
  tokenize='porter unicode61'
);

-- triggers keep notes_fts in sync with notes (insert/update/delete)

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

Settings keys (all values stored as JSON strings):
- `provider` — `"anthropic" | "openrouter" | "custom"`
- `base_url` — string (optional; Anthropic default is the SDK's, OpenRouter is `https://openrouter.ai/api/v1`, custom = user-provided)
- `api_key_encrypted` — base64 ciphertext from `safeStorage.encryptString`
- `model` — string
- `hotkey_enabled` — boolean
- `hotkey_accelerator` — string (Electron Accelerator format, e.g. `"CommandOrControl+Shift+N"`)
- `keep_audio_default` — boolean (default true)

Migrations applied on startup via a simple versioned runner (`src/main/db/migrations/001_init.sql`, etc). No ORM.

## LLM provider configuration

User picks provider in Settings:

- **Anthropic** — native SDK. `apiKey` is the Anthropic key. Model default: `claude-opus-4-7`. Base URL not shown (uses SDK default).
- **OpenRouter** — `openai` SDK with `baseURL = "https://openrouter.ai/api/v1"`. API key is the OpenRouter key. Model example: `anthropic/claude-opus-4-7`.
- **Custom (OpenAI-compatible)** — `openai` SDK with user-supplied `baseURL`, `apiKey`, and `model`. Covers Ollama, LM Studio, Groq, Together, any future gateway.

The `LLMClient` is resolved at call time from settings, so switching providers doesn't require restart. All requests use streaming. On Anthropic, the system prompt is marked with `cache_control: ephemeral` so prompt caching kicks in for users who stay on the same provider.

The exact library versions (Anthropic SDK, OpenAI SDK, Electron, electron-vite, electron-builder, better-sqlite3, @electron/rebuild) will be pinned in the implementation plan using the most current stable releases available at implementation time. No deprecated APIs.

## Whisper integration

- **Model:** `ggml-base.en.bin` (142 MB, English-only) by default. Good latency/quality tradeoff for notetaking. Settings exposes a "larger model = better accuracy" toggle for users who want `small.en` or `medium.en` and are willing to wait for the download.
- **Sidecar binaries** built from the upstream `ggml-org/whisper.cpp` repo at a pinned tag, placed in `resources/bin/<mac-arm64|mac-x64|win-x64|linux-x64>/whisper(.exe)`.
- **Model download:** on first run and when the user switches models, the app downloads from the upstream Hugging Face mirror referenced by whisper.cpp's own model-fetch script. File is SHA-256 verified against a hash list we bake into the app; corrupt/partial downloads are deleted and retried up to 3 times.
- **Audio preprocessing:** the renderer emits WebM/Opus. Whisper wants 16 kHz mono WAV. We bundle `ffmpeg` as another sidecar and run: `ffmpeg -i input.webm -ar 16000 -ac 1 -f wav output.wav`.

## Recording triggers

- In-app button (always available) in the top of the app window; also bound to `Space` on the list screen for convenience.
- Global hotkey — opt-in. When enabled, pressing the accelerator starts/stops recording regardless of app focus. If the main window is hidden, recording runs in a minimal always-on-top "recording…" overlay window; stopping dismisses the overlay and opens the new note in the main window.

## Error handling

One principle: **never lose user work.** Audio is the source of truth until transcription succeeds; transcript is the source of truth until notes succeed.

| Failure | Behavior |
|--------|----------|
| Mic permission denied | Renderer shows a "Grant microphone access" panel with OS-specific instructions. Never auto-retry. |
| Whisper binary missing / crashes | Note row goes to `transcription_failed` with stderr excerpt in `error_message`. Note card shows a "Retry transcription" button. |
| Model missing on first run | Download UI with progress + cancel. On cancel, failure with a clear message and a retry button. |
| LLM 401 / invalid key | `generation_failed`. Toast: "Invalid API key" with a button that opens Settings focused on the key field. |
| LLM rate limit (429) | Exponential backoff up to 3 attempts; if still failing, `generation_failed` with "Rate limited — try again later." |
| LLM network error / offline | Status set to `pending_network`. A lightweight watcher auto-retries when `navigator.onLine` flips true. Transcript remains accessible. |
| Crash mid-pipeline | On startup, any note stuck in `transcribing` or `generating` is moved to the corresponding `_failed` state with a message. User retries from the note card. |
| User deletes audio while transcription running | Pipeline aborts cleanly; note is deleted with the audio. |
| SQLite corruption | On open failure, app surfaces a recovery screen that offers to back up the DB file and reinitialize. No silent data loss. |

All errors are logged to `userData/logs/app.log` with rotation (7 days). Settings has a "Copy logs" button for bug reports.

## Security

- Renderer sandboxed, context-isolated. Preload exposes only the typed IPC API; no Node built-ins.
- API keys encrypted via `safeStorage` (OS keychain on Mac/Win, libsecret on Linux where available). Never logged; never sent anywhere except the configured provider endpoint over HTTPS.
- Content Security Policy locked down: no remote script execution, inline scripts disabled, renderer fetches only from configured provider base URLs.
- App updates, when added later, will be signature-verified via `electron-updater`.

## Testing

- **Unit (Vitest, no Electron):** `NoteStore` against an in-memory SQLite, `LLMClient` implementations against `undici`'s `MockAgent`, prompt-builder snapshot tests, settings encryption/decryption, the migration runner.
- **IPC contract tests:** boot main in a headless harness, invoke each handler, assert DB state and events. Covers the full pipeline with `WhisperRunner` and `LLMClient` faked.
- **Audio-pipeline integration test:** real bundled `whisper` + `ffmpeg` on a small fixture audio file, one test per supported OS in CI. Asserts transcript shape, not exact text.
- **Renderer components:** Vitest + React Testing Library for list, detail/editor, settings. IPC mocked.
- **E2E:** Playwright for Electron — golden path (record short clip → see streaming notes → edit → search finds it → delete). One spec per OS in CI.

Coverage target: 80% on main-process services, 60% on renderer. Enforced per-PR.

## Packaging & distribution

- Build: `electron-vite` — separate bundles for main, preload, renderer. Source maps in dev, minified in prod.
- Packager: `electron-builder`.
  - Mac: universal `.dmg` (arm64 + x64).
  - Windows: NSIS installer `.exe`.
  - Linux: `AppImage` (primary) + `.deb` (secondary).
- Native modules: `npmRebuild: true`; `better-sqlite3` in `asarUnpack` so the loader can read it from the installed app. `@electron/rebuild` as a devDependency with a `postinstall` hook.
- Sidecars: `resources/bin/**` listed in `extraResources`. Referenced in main via `process.resourcesPath` in production, repo-local path in dev (detected by `app.isPackaged`).
- Code signing / notarization: Mac Developer ID + notarytool workflow and Windows Authenticode are required for distribution outside the dev's machine but are deferred to post-v1 and not blocking the initial build.

## Repository layout

```
/
├── docs/superpowers/specs/
│   └── 2026-04-19-vinu-design.md
├── src/
│   ├── main/
│   │   ├── index.ts                 # app bootstrap, window, IPC wiring
│   │   ├── ipc/                     # handler modules
│   │   ├── whisper/                 # WhisperRunner, AudioPreprocessor, model-manager
│   │   ├── llm/
│   │   │   ├── client.ts            # LLMClient interface
│   │   │   ├── anthropic.ts
│   │   │   ├── openai-compat.ts
│   │   │   └── prompts.ts
│   │   ├── db/
│   │   │   ├── store.ts             # NoteStore
│   │   │   ├── migrations/001_init.sql
│   │   │   └── runner.ts
│   │   ├── settings.ts              # SettingsStore
│   │   └── hotkey.ts                # HotkeyManager
│   ├── preload/
│   │   └── index.ts                 # typed contextBridge API
│   └── renderer/
│       ├── App.tsx
│       ├── pages/{List,Detail,Settings}.tsx
│       ├── components/
│       └── ipc.ts                   # thin wrapper over window.api
├── resources/bin/{mac-arm64,mac-x64,win-x64,linux-x64}/
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
└── tsconfig*.json
```

## Open questions (to resolve in planning, not now)

- Exact markdown editor — plain textarea with syntax highlighting (cheap, fine for personal use) vs. a proper WYSIWYG markdown editor. Lean: plain textarea for v1, revisit if the editing experience is lacking.
- Whether the "recording in the background" overlay should capture a draft title via a quick prompt after stopping, or always let the LLM pick. Lean: always LLM (one less decision for the user).
- Whether transcripts are exposed in the UI by default or hidden behind a "Show raw transcript" toggle. Lean: hidden; the notes are the product.

These are minor and will be settled in the implementation plan.
