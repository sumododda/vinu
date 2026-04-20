# vinu

A voice-first notetaking desktop app. Hit a hotkey, speak, and vinu turns
your thought into clean markdown notes. **Transcription is 100% local** via
[`whisper.cpp`](https://github.com/ggml-org/whisper.cpp); only the final
summary call leaves your machine, and only to the LLM provider you choose.

- Local-first audio + transcripts (SQLite at `~/Library/Application Support/vinu`)
- Your API key never leaves the machine — encrypted at rest via the OS keychain
- Works with **Anthropic**, **OpenRouter**, or any **OpenAI-compatible** base URL (Ollama, LM Studio, Groq, Together, …)
- Full-text search across all notes (SQLite FTS5)
- Editable markdown, raw transcript preserved per note

---

## Install

> macOS 15+ (Sequoia) / macOS 26+ supported. Windows + Linux builds ship from the same CI pipeline; binaries are produced but less battle-tested.

1. Grab the latest **`vinu-x.y.z-arm64.dmg`** (Apple Silicon) or **`vinu-x.y.z.dmg`** (Intel) from the [Releases page](https://github.com/sumododda/vinu/releases/latest).
2. Mount the DMG, drag **vinu** into Applications.
3. Launch. Unsigned dev builds will prompt "Apple cannot verify..." once — right-click → **Open** to bypass. Signed+notarized builds launch cleanly.
4. Grant **Microphone** access on first record. vinu asks only for microphone.
5. Open **Settings** (gear icon), paste your provider API key, and pick a model.

### Hotkey

Default global hotkey: <kbd>⌘</kbd><kbd>⇧</kbd><kbd>N</kbd>. Change it in Settings → **Shortcut** → Change, then press the combo you want. Esc cancels.

### Where data lives

| | macOS | Linux | Windows |
|---|---|---|---|
| SQLite DB | `~/Library/Application Support/vinu/vinu.db` | `~/.config/vinu/vinu.db` | `%APPDATA%\vinu\vinu.db` |
| Audio blobs | `…/vinu/audio/` | `…/vinu/audio/` | `…\vinu\audio\` |
| Whisper models | `…/vinu/models/` | `…/vinu/models/` | `…\vinu\models\` |

Uninstall = delete the app + that folder. No cloud sync, no telemetry.

---

## Develop

Requirements: Node 20+, `cmake` (macOS: `brew install cmake`; Ubuntu: `sudo apt install cmake build-essential`; Windows: VS Build Tools). The first `npm run fetch:sidecars` compiles `whisper.cpp` from source which takes a few minutes.

```bash
git clone https://github.com/sumododda/vinu.git
cd vinu
npm ci
npm run fetch:sidecars        # downloads ffmpeg + builds whisper-cli
npm run dev                   # starts electron-vite dev server
```

Before committing:

```bash
npm run typecheck
npm test
npm run lint
```

### Sidecars

`scripts/fetch-sidecars.mjs` fetches (or builds) platform-specific binaries into `resources/bin/<platform>/`. Versions and SHA-256 hashes are pinned in `scripts/sidecar-manifest.json`:

- **ffmpeg**: [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) release `b6.1.1` (static, per-arch binaries — no dylib hunt)
- **whisper.cpp**: cloned at the pinned tag and built via `cmake -DBUILD_SHARED_LIBS=OFF -DGGML_METAL_EMBED_LIBRARY=ON` for a self-contained `whisper-cli` with Metal shaders embedded

Every download is SHA-256 verified; a mismatch aborts the script rather than silently shipping tampered binaries. The script uses `spawnSync` (no shell injection surface).

### Whisper models

The first recording triggers a download of `ggml-base.en.bin` (~150 MB) into the app-data `models/` folder. Model URL + SHA-256 are pinned in `src/main/whisper/registry.ts`. Downloads support HTTP `Range` resume and exponential-backoff retry.

### Fonts

Self-hosted via `@fontsource-variable/public-sans` + `@fontsource/libre-bodoni`. No CDN, no FOIT. Bundled fonts total ~120 KB WOFF2.

---

## Packaging

```bash
# host platform
npm run package

# explicit
npm run package:mac
npm run package:win
npm run package:linux
```

`electron-builder.cjs` branches on `CSC_NAME` / `CSC_LINK`:

- **Absent (local dev)** — ad-hoc signs without hardened runtime so macOS 15+ Gatekeeper doesn't hard-reject.
- **Present (release)** — full stack: hardened runtime + entitlements + `@electron/notarize` via `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`.

The macOS sidecars (`ffmpeg`, `whisper`) are listed in `mac.binaries` so they're re-signed with inherit entitlements — required or Gatekeeper kills them on launch in notarized builds.

### Icon

Source: `build/icon.svg`. Regenerate the PNG any time:

```bash
npm run gen:icon      # renders → build/icon.png (1024x1024)
```

electron-builder auto-converts to `.icns` (macOS) / `.ico` (Windows) at packaging time.

---

## Release

Tagged pushes run the full matrix (macOS / Windows / Linux) and publish artifacts to a GitHub Release.

```bash
# one-liner
git tag v0.1.0
git push origin v0.1.0
```

See [`.github/workflows/release.yml`](.github/workflows/release.yml) for the full pipeline. For signed + notarized macOS releases, set these repository secrets:

| Secret | Purpose |
|---|---|
| `CSC_LINK` | Base-64 encoded `.p12` developer certificate |
| `CSC_KEY_PASSWORD` | p12 password |
| `CSC_NAME` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-char team identifier |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows code signing (optional) |

Unset secrets → electron-builder skips signing (still produces usable unsigned installers).

---

## Architecture

```
┌─ Renderer (React 19) ────────────────────────────┐
│  ListPage ▸ DetailPage ▸ SettingsPage ▸ Recorder │
└────────────────────────┬─────────────────────────┘
                         │ IPC over contextBridge
┌────────────────────────▼─────────────────────────┐
│  Main (Node)                                     │
│    Pipeline → ffmpeg ▸ whisper ▸ LLMClient       │
│    SettingsStore  ·  NoteStore (SQLite + FTS5)   │
│    HotkeyManager (globalShortcut)                │
└──────────────────────────────────────────────────┘
```

- **Security**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP locked to provider hosts, `will-navigate` + `setWindowOpenHandler` guards, per-channel IPC input validation with UUID + size caps, sidecars spawned via `shell: false` with absolute paths, SQL entirely parameterised, FTS5 MATCH escaped.
- **Resilience**: LLM calls retry with SDK-native `maxRetries` + `timeout` and surface typed errors (`timeout | rate_limit | auth | network | aborted | bad_request | server | unknown`). Whisper model downloads resume from `.part` with exponential backoff.
- **Tests**: 88 unit/integration tests (vitest) + Playwright smoke covering the record → transcribe → summarise golden path.

---

## License

MIT. See [`LICENSE`](LICENSE).
