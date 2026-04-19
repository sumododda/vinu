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
    const encrypt = vi.spyOn(fakeSafeStorage, 'encryptString');
    const store = new SettingsStore(freshDb(), fakeSafeStorage as any);
    store.write({ ...store.read(), apiKey: 'sk-secret' });
    expect(encrypt).toHaveBeenCalledWith('sk-secret');
  });

  it('falls back to plaintext when encryption is unavailable', () => {
    const noEncryption = { ...fakeSafeStorage, isEncryptionAvailable: () => false };
    const db = freshDb();
    const store = new SettingsStore(db, noEncryption as any);
    store.write({ ...store.read(), apiKey: 'sk-plain' });
    expect(store.read().apiKey).toBe('sk-plain');
  });
});
