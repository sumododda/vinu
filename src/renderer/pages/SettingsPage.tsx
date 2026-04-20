import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Settings } from '../lib/api';

const PROVIDER_DEFAULTS: Record<Settings['provider'], { baseUrl: string; modelHint: string }> = {
  anthropic: { baseUrl: '', modelHint: 'claude-opus-4-7' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', modelHint: 'anthropic/claude-opus-4-7' },
  custom: { baseUrl: '', modelHint: 'e.g. llama3.2 (Ollama) or gpt-4o-mini' },
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function nextBaseUrl(
  currentBaseUrl: string,
  currentProvider: Settings['provider'],
  nextProvider: Settings['provider'],
) {
  const currentDefault = PROVIDER_DEFAULTS[currentProvider].baseUrl;
  const nextDefault = PROVIDER_DEFAULTS[nextProvider].baseUrl;

  if (!currentBaseUrl.trim() || currentBaseUrl === currentDefault) {
    return nextDefault;
  }

  return currentBaseUrl;
}

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
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
        setS(settings);
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

  if (isLoading) return <p>Loading…</p>;

  if (loadError) {
    return (
      <div style={{ maxWidth: 640 }}>
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Settings</h2>
          <div className="spacer" />
          <a href="#/">Back</a>
        </div>

        <p role="alert" style={{ color: 'var(--accent)' }}>
          {loadError}
        </p>
        <button onClick={() => setLoadVersion((v) => v + 1)}>Retry</button>
      </div>
    );
  }

  if (!s) return <p>Unable to load settings.</p>;

  function update<K extends keyof Settings>(k: K, v: Settings[K]) {
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
    } catch (error) {
      setSaveError(getErrorMessage(error, 'Failed to save settings'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Settings</h2>
        <div className="spacer" />
        <a href="#/">Back</a>
      </div>

      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend>LLM Provider</legend>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
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
              />{' '}
              {p}
            </label>
          ))}
        </div>

        <label>
          API Key
          <input
            type="password"
            value={s.apiKey}
            onChange={(e) => update('apiKey', e.target.value)}
            placeholder="sk-…"
          />
        </label>
        <small style={{ display: 'block', marginTop: 6, color: 'var(--muted)' }}>
          Stored locally and encrypted when your OS keychain/keyring is available.
        </small>

        <label style={{ marginTop: 8, display: 'block' }}>
          Base URL
          <input
            value={s.baseUrl}
            onChange={(e) => update('baseUrl', e.target.value)}
            placeholder={PROVIDER_DEFAULTS[s.provider].baseUrl || 'SDK default'}
            disabled={s.provider === 'anthropic'}
          />
        </label>

        <label style={{ marginTop: 8, display: 'block' }}>
          Model
          <input
            value={s.model}
            onChange={(e) => update('model', e.target.value)}
            placeholder={PROVIDER_DEFAULTS[s.provider].modelHint}
          />
        </label>
      </fieldset>

      <fieldset style={{ border: 'none', padding: 0, marginTop: 24 }}>
        <legend>Recording</legend>
        <label>
          <input
            type="checkbox"
            checked={s.hotkeyEnabled}
            onChange={(e) => update('hotkeyEnabled', e.target.checked)}
          />{' '}
          Enable global hotkey
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          Hotkey
          <input
            value={s.hotkeyAccelerator}
            onChange={(e) => update('hotkeyAccelerator', e.target.value)}
            disabled={!s.hotkeyEnabled}
            placeholder="CommandOrControl+Shift+N"
          />
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={s.keepAudioDefault}
            onChange={(e) => update('keepAudioDefault', e.target.checked)}
          />{' '}
          Keep audio files by default (you can delete per-note)
        </label>
      </fieldset>

      <div style={{ marginTop: 24 }}>
        <button className="primary" onClick={save} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        {saveError && (
          <small role="alert" style={{ marginLeft: 8, color: 'var(--accent)' }}>
            {saveError}
          </small>
        )}
        {savedAt && (
          <small style={{ marginLeft: 8, color: 'var(--muted)' }}>Saved.</small>
        )}
      </div>
    </div>
  );
}
