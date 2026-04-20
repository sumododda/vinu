# vinu

Cross-platform desktop notetaking app. Press a button or a global hotkey, speak, and the app turns your speech into clean readable notes — locally transcribed, then summarized by Claude (or any OpenAI-compatible LLM you point it at).

## Stack

- Electron + React + TypeScript (`electron-vite`, `electron-builder`)
- `better-sqlite3` (FTS5 for search)
- `whisper.cpp` sidecar for local transcription
- `ffmpeg` sidecar to remux audio to 16kHz mono WAV
- `@anthropic-ai/sdk` (default) or `openai` SDK pointed at OpenRouter / any custom base URL

## Develop

```bash
npm install                       # also fetches sidecar binaries
npm run dev                       # starts electron-vite dev server
npm run typecheck && npm test     # before commits
```

### Sidecars

Sidecar binaries are downloaded into `resources/bin/<platform>/` by `scripts/fetch-sidecars.mjs` (run automatically by `postinstall`). The script ships with `REPLACE_…` placeholder URLs — fill them in with verified release URLs from:

- whisper.cpp: https://github.com/ggml-org/whisper.cpp/releases
- ffmpeg static builds: https://evermeet.cx/ffmpeg/ (Mac), https://www.gyan.dev/ffmpeg/builds/ (Win), https://johnvansickle.com/ffmpeg/ (Linux)

Update `src/main/whisper/registry.ts` with the matching SHA-256 from upstream for each model. The first run downloads the default `ggml-base.en.bin` model into `userData/models/`.

## Configure a provider

Open Settings inside the app and pick:

- **Anthropic** — paste an Anthropic API key. Default model: `claude-opus-4-7`.
- **OpenRouter** — paste an OpenRouter key.
- **Custom (OpenAI-compatible)** — supply base URL, key, model. Works with Ollama, LM Studio, Groq, Together, etc.

Keys are encrypted at rest via Electron `safeStorage` (OS keychain).

## Package

```bash
npm run package          # uses host platform
npm run package:mac
npm run package:win
npm run package:linux
```
