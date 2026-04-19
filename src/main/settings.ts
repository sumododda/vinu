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

export class SettingsStore {
  constructor(
    private readonly db: Database.Database,
    private readonly safeStorage: SafeStorage,
  ) {}

  read(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
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

    let apiKey = '';
    const encrypted = map.get(KEY_API_ENCRYPTED);
    if (encrypted) {
      try {
        apiKey = this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      } catch {
        apiKey = '';
      }
    } else {
      apiKey = map.get(KEY_API_PLAINTEXT) ?? '';
    }

    return {
      provider: get('provider') ?? DEFAULTS.provider,
      apiKey,
      baseUrl: get('baseUrl') ?? DEFAULTS.baseUrl,
      model: get('model') ?? DEFAULTS.model,
      hotkeyEnabled: get('hotkeyEnabled') ?? DEFAULTS.hotkeyEnabled,
      hotkeyAccelerator: get('hotkeyAccelerator') ?? DEFAULTS.hotkeyAccelerator,
      keepAudioDefault: get('keepAudioDefault') ?? DEFAULTS.keepAudioDefault,
    };
  }

  write(s: Settings): void {
    const upsert = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );

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

      this.db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(
        KEY_API_ENCRYPTED,
        KEY_API_PLAINTEXT,
      );
      if (settings.apiKey) {
        if (this.safeStorage.isEncryptionAvailable()) {
          const enc = this.safeStorage.encryptString(settings.apiKey).toString('base64');
          upsert.run(KEY_API_ENCRYPTED, enc);
        } else {
          upsert.run(KEY_API_PLAINTEXT, settings.apiKey);
        }
      }
    });

    tx(s);
  }
}
