import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { RendererSettings } from '../lib/api';
import { BackIcon, CheckIcon } from '../components/Icons';
import { HotkeyRecorder } from '../components/HotkeyRecorder';

type EditableSettings = RendererSettings & { apiKey: string };

const PROVIDER_DEFAULTS: Record<EditableSettings['provider'], { baseUrl: string; modelHint: string }> = {
  anthropic: { baseUrl: '', modelHint: 'claude-opus-4-7' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', modelHint: 'anthropic/claude-opus-4-7' },
  custom: { baseUrl: '', modelHint: 'e.g. llama3.2 (Ollama) or gpt-4o-mini' },
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function nextBaseUrl(
  currentBaseUrl: string,
  currentProvider: EditableSettings['provider'],
  nextProvider: EditableSettings['provider'],
) {
  const currentDefault = PROVIDER_DEFAULTS[currentProvider].baseUrl;
  const nextDefault = PROVIDER_DEFAULTS[nextProvider].baseUrl;

  if (!currentBaseUrl.trim() || currentBaseUrl === currentDefault) {
    return nextDefault;
  }

  return currentBaseUrl;
}

export function SettingsPage() {
  const [s, setS] = useState<EditableSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setLoadError(null);

    api.settings
      .get()
      .then((settings) => {
        if (cancelled) return;
        setS({ ...settings, apiKey: '' });
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(getErrorMessage(error, 'Failed to load settings'));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadVersion]);

  if (isLoading) {
    return (
      <div className="empty-hero">
        <p>Loading settings…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="settings-page">
        <header className="settings-header">
          <h2>Settings</h2>
          <a href="#/" className="back"><BackIcon /> Back</a>
        </header>
        <div className="alert" role="alert">{loadError}</div>
        <button className="solid" onClick={() => setLoadVersion((v) => v + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (!s) return <p>Unable to load settings.</p>;

  function update<K extends keyof EditableSettings>(k: K, v: EditableSettings[K]) {
    setSavedAt(null);
    setSaveError(null);
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  async function save() {
    if (!s) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      await api.settings.set(s);
      setSavedAt(Date.now());
      setS((prev) =>
        prev ? { ...prev, hasApiKey: prev.hasApiKey || prev.apiKey.length > 0, apiKey: '' } : prev,
      );
    } catch (error) {
      setSaveError(getErrorMessage(error, 'Failed to save settings'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h2>Settings</h2>
        <a href="#/" className="back"><BackIcon /> Back</a>
      </header>

      <section className="card">
        <h3>LLM provider</h3>
        <p className="card-desc">Choose where summaries are generated. Keys stay on this machine.</p>

        <div className="field">
          <span className="field-label">Provider</span>
          <div className="segment" role="radiogroup" aria-label="LLM provider">
            {(['anthropic', 'openrouter', 'custom'] as const).map((p) => (
              <label key={p}>
                <input
                  type="radio"
                  name="provider"
                  checked={s.provider === p}
                  onChange={() => {
                    const updatedBaseUrl = nextBaseUrl(s.baseUrl, s.provider, p);
                    update('provider', p);
                    if (updatedBaseUrl !== s.baseUrl) update('baseUrl', updatedBaseUrl);
                  }}
                />
                {p}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="apiKey">API key</label>
          <input
            id="apiKey"
            type="password"
            value={s.apiKey}
            onChange={(e) => update('apiKey', e.target.value)}
            placeholder={s.hasApiKey ? 'Stored securely — type to replace' : 'sk-…'}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="hint">
            Encrypted at rest via your OS keychain. The stored key is never read
            back into the renderer — leave blank to keep the current key.
          </span>
        </div>

        <div className="field">
          <label htmlFor="baseUrl">Base URL</label>
          <input
            id="baseUrl"
            type="text"
            value={s.baseUrl}
            onChange={(e) => update('baseUrl', e.target.value)}
            placeholder={PROVIDER_DEFAULTS[s.provider].baseUrl || 'SDK default'}
            disabled={s.provider === 'anthropic'}
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <input
            id="model"
            type="text"
            value={s.model}
            onChange={(e) => update('model', e.target.value)}
            placeholder={PROVIDER_DEFAULTS[s.provider].modelHint}
            spellCheck={false}
          />
        </div>
      </section>

      <section className="card">
        <h3>Recording</h3>
        <p className="card-desc">Global hotkey and audio retention.</p>

        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={s.hotkeyEnabled}
              onChange={(e) => update('hotkeyEnabled', e.target.checked)}
            />
            Enable global hotkey
          </label>
        </div>

        <div className="field">
          <span className="field-label">Shortcut</span>
          <HotkeyRecorder
            value={s.hotkeyAccelerator}
            disabled={!s.hotkeyEnabled}
            onChange={(next) => update('hotkeyAccelerator', next)}
          />
          <span className="hint">
            Click <em>Change</em> and press your combination. Use at least one modifier
            (⌘, ⌥, ⌃, or ⇧) plus a key. Press <kbd>Esc</kbd> to cancel.
          </span>
        </div>

        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={s.keepAudioDefault}
              onChange={(e) => update('keepAudioDefault', e.target.checked)}
            />
            Keep audio files after transcription
          </label>
          <span className="hint">
            When off, the original recording is removed once the summary is generated.
          </span>
        </div>
      </section>

      <div className="save-bar">
        <button className="primary" onClick={() => void save()} disabled={isSaving}>
          {isSaving ? null : <CheckIcon />}
          {isSaving ? 'Saving…' : 'Save changes'}
        </button>
        {saveError && (
          <span className="status error" role="alert">
            {saveError}
          </span>
        )}
        {savedAt && !saveError && <span className="status">Saved.</span>}
      </div>
    </div>
  );
}
