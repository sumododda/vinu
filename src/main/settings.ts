import type Database from 'better-sqlite3';
import type { safeStorage as ElectronSafeStorage } from 'electron';
import type { Provider, Settings } from '@shared/types';

export type { Provider, Settings };

const DEFAULTS: Settings = {
  provider: 'anthropic',
  apiKey: '',
  baseUrl: '',
  model: 'claude-opus-4-7',
  hotkeyEnabled: false,
  hotkeyAccelerator: 'CommandOrControl+Shift+N',
  keepAudioDefault: true,
};

const KEY_API_ENCRYPTED = 'api_key_encrypted';
const KEY_API_PLAINTEXT = 'api_key_plaintext';

type SafeStorage = Pick<
  typeof ElectronSafeStorage,
  'isEncryptionAvailable' | 'encryptString' | 'decryptString'
>;

export type SettingsChangeListener = (next: Settings) => void;

/**
 * API key is kept encrypted at rest via Electron `safeStorage`
 * (macOS Keychain / Windows DPAPI / libsecret on Linux).
 *
 * To stop the Keychain from prompting on every read/write, we cache the
 * decrypted key in memory and remember the ciphertext we most recently
 * saw. That lets us:
 *
 *   - skip a `decryptString()` call when the row in the DB hasn't changed
 *     since the last read (no prompt);
 *   - skip an `encryptString()` call on save when the new plaintext equals
 *     the one currently cached (no prompt).
 *
 * With this, a full session after the initial unlock hits `safeStorage`
 * at most once — the first `read()` on startup. All subsequent reads and
 * every save-where-key-didn't-change are resolved from cache.
 */
export class SettingsStore {
  private readonly readAllStmt: Database.Statement;
  private readonly upsertStmt: Database.Statement;
  private readonly deleteApiKeysStmt: Database.Statement;

  private readonly listeners = new Set<SettingsChangeListener>();

  // In-memory cache of the current API key so we can answer reads + skip
  // redundant writes without touching safeStorage.
  private cachedApiKey: string | null = null;
  // The ciphertext string in the DB that `cachedApiKey` was derived from.
  // Lets us detect external DB changes (another process) and invalidate.
  private cachedCipher: string | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly safeStorage: SafeStorage,
  ) {
    this.readAllStmt = db.prepare('SELECT key, value FROM settings');
    this.upsertStmt = db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    this.deleteApiKeysStmt = db.prepare('DELETE FROM settings WHERE key IN (?, ?)');
  }

  read(): Settings {
    const rows = this.readAllStmt.all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const get = <K extends keyof Settings>(key: K): Settings[K] | undefined => {
      const raw = map.get(key);
      if (raw === undefined) return undefined;
      try {
        return JSON.parse(raw) as Settings[K];
      } catch {
        return undefined;
      }
    };

    return {
      provider: get('provider') ?? DEFAULTS.provider,
      apiKey: this.resolveApiKey(map),
      baseUrl: get('baseUrl') ?? DEFAULTS.baseUrl,
      model: get('model') ?? DEFAULTS.model,
      hotkeyEnabled: get('hotkeyEnabled') ?? DEFAULTS.hotkeyEnabled,
      hotkeyAccelerator: get('hotkeyAccelerator') ?? DEFAULTS.hotkeyAccelerator,
      keepAudioDefault: get('keepAudioDefault') ?? DEFAULTS.keepAudioDefault,
    };
  }

  /**
   * Resolve the plaintext API key from the DB, touching safeStorage at
   * most once per unique ciphertext.
   */
  private resolveApiKey(map: Map<string, string>): string {
    const encrypted = map.get(KEY_API_ENCRYPTED);
    if (encrypted) {
      // Same ciphertext as last successful decrypt → use cache.
      if (this.cachedCipher === encrypted && this.cachedApiKey !== null) {
        return this.cachedApiKey;
      }
      let decrypted = '';
      try {
        if (this.safeStorage.isEncryptionAvailable()) {
          decrypted = this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
        }
      } catch {
        // Denied / different signing identity / corrupted: give up quietly,
        // user will see empty API key field and can re-enter.
      }
      this.cachedCipher = encrypted;
      this.cachedApiKey = decrypted;
      return decrypted;
    }

    // No encrypted row — fall back to the plaintext row used when encryption
    // is unavailable (e.g. Linux without a keyring).
    const plain = map.get(KEY_API_PLAINTEXT) ?? '';
    this.cachedCipher = null;
    this.cachedApiKey = plain;
    return plain;
  }

  write(s: Settings): void {
    const upsert = this.upsertStmt;
    const deleteApiKeys = this.deleteApiKeysStmt;
    const safeStorage = this.safeStorage;

    // Decide the api-key operation before the transaction so we only touch
    // safeStorage when the value genuinely changed.
    const apiKeyUnchanged = s.apiKey === this.cachedApiKey;

    let nextCipher: string | null = null;
    if (s.apiKey) {
      if (apiKeyUnchanged && this.cachedCipher) {
        // Same key as before — reuse existing ciphertext, no keychain prompt.
        nextCipher = this.cachedCipher;
      } else if (safeStorage.isEncryptionAvailable()) {
        nextCipher = safeStorage.encryptString(s.apiKey).toString('base64');
      }
    }

    const tx = this.db.transaction((settings: Settings) => {
      const fieldsToPersist: Array<[string, unknown]> = [
        ['provider', settings.provider],
        ['baseUrl', settings.baseUrl],
        ['model', settings.model],
        ['hotkeyEnabled', settings.hotkeyEnabled],
        ['hotkeyAccelerator', settings.hotkeyAccelerator],
        ['keepAudioDefault', settings.keepAudioDefault],
      ];
      for (const [k, v] of fieldsToPersist) {
        upsert.run(k, JSON.stringify(v));
      }

      deleteApiKeys.run(KEY_API_ENCRYPTED, KEY_API_PLAINTEXT);
      if (settings.apiKey) {
        if (nextCipher) {
          upsert.run(KEY_API_ENCRYPTED, nextCipher);
        } else {
          upsert.run(KEY_API_PLAINTEXT, settings.apiKey);
        }
      }
    });

    tx(s);

    // Sync the cache with what we just persisted.
    this.cachedApiKey = s.apiKey;
    this.cachedCipher = nextCipher;

    for (const listener of this.listeners) {
      try {
        listener(s);
      } catch (err) {
        // Swallow observer errors — a broken subscriber shouldn't corrupt
        // the write path or starve sibling listeners — but log so silent
        // failures surface in dev tools instead of rotting.
        console.error('[settings] listener threw after write:', err);
      }
    }
  }

  /**
   * Subscribe to settings changes. The listener fires after a successful
   * `write()` with the newly-persisted settings. Returns an unsubscribe fn.
   */
  onChange(listener: SettingsChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
