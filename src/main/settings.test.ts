import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './db/runner';
import initSql from './db/migrations/001_init.sql?raw';
import { SettingsStore, type Settings } from './settings';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db, [{ version: 1, sql: initSql }]);
  return db;
}

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
};

function spyable() {
  return {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc:/, '')),
  };
}

describe('SettingsStore', () => {
  it('returns defaults when nothing is persisted', () => {
    const store = new SettingsStore(freshDb(), fakeSafeStorage as any);
    const s: Settings = store.read();
    expect(s.provider).toBe('anthropic');
    expect(s.apiKey).toBe('');
    expect(s.hotkeyEnabled).toBe(false);
    expect(s.keepAudioDefault).toBe(true);
    expect(s.model).toBe('claude-opus-4-7');
  });

  it('persists and re-reads settings', () => {
    const db = freshDb();
    const store = new SettingsStore(db, fakeSafeStorage as any);
    store.write({
      provider: 'openrouter',
      apiKey: 'sk-test',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4-7',
      hotkeyEnabled: true,
      hotkeyAccelerator: 'CommandOrControl+Shift+N',
      keepAudioDefault: false,
    });
    const fresh = new SettingsStore(db, fakeSafeStorage as any);
    expect(fresh.read()).toEqual({
      provider: 'openrouter',
      apiKey: 'sk-test',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4-7',
      hotkeyEnabled: true,
      hotkeyAccelerator: 'CommandOrControl+Shift+N',
      keepAudioDefault: false,
    });
  });

  it('encrypts the api key on write', () => {
    const safe = spyable();
    const store = new SettingsStore(freshDb(), safe as any);
    store.write({ ...store.read(), apiKey: 'sk-secret' });
    expect(safe.encryptString).toHaveBeenCalledWith('sk-secret');
  });

  it('falls back to plaintext when encryption is unavailable', () => {
    const noEncryption = { ...fakeSafeStorage, isEncryptionAvailable: () => false };
    const db = freshDb();
    const store = new SettingsStore(db, noEncryption as any);
    store.write({ ...store.read(), apiKey: 'sk-plain' });
    expect(store.read().apiKey).toBe('sk-plain');
  });

  it('skips encryption when the api key has not changed between writes', () => {
    const safe = spyable();
    const store = new SettingsStore(freshDb(), safe as any);
    store.write({ ...store.read(), apiKey: 'sk-stable' });
    expect(safe.encryptString).toHaveBeenCalledTimes(1);

    // Second write with the same key: toggling an unrelated flag should not
    // trigger another encryption round-trip (and thus no Keychain prompt).
    const current = store.read();
    store.write({ ...current, hotkeyEnabled: !current.hotkeyEnabled });
    expect(safe.encryptString).toHaveBeenCalledTimes(1);

    // And the key is still intact.
    expect(store.read().apiKey).toBe('sk-stable');
  });

  it('decrypts the api key at most once per unique ciphertext', () => {
    const safe = spyable();
    const db = freshDb();
    const store = new SettingsStore(db, safe as any);
    store.write({ ...store.read(), apiKey: 'sk-once' });
    // Prime state once (this may have decrypted 0 or 1 times depending on
    // whether write paths triggered a read — normalize by reading again).
    safe.decryptString.mockClear();

    expect(store.read().apiKey).toBe('sk-once');
    expect(store.read().apiKey).toBe('sk-once');
    expect(store.read().apiKey).toBe('sk-once');
    // Three reads after priming — zero additional decrypts because the
    // ciphertext is unchanged and cached.
    expect(safe.decryptString).toHaveBeenCalledTimes(0);
  });

  it('re-decrypts when the ciphertext changes under it', () => {
    const safe = spyable();
    const db = freshDb();
    const store = new SettingsStore(db, safe as any);
    store.write({ ...store.read(), apiKey: 'sk-initial' });
    store.read();
    safe.decryptString.mockClear();

    // Simulate another writer (or a direct DB edit) replacing the row.
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run('api_key_encrypted', Buffer.from('enc:sk-replaced').toString('base64'));

    expect(store.read().apiKey).toBe('sk-replaced');
    expect(safe.decryptString).toHaveBeenCalledTimes(1);
  });

  it('falls back to defaults when a settings row is corrupt', () => {
    const db = freshDb();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('provider', 'not-json{');
    const store = new SettingsStore(db, fakeSafeStorage as any);
    expect(store.read().provider).toBe('anthropic');
  });
});
