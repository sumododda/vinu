import { describe, it, expect } from 'vitest';
import { openDatabase } from './index';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('openDatabase', () => {
  it('applies the initial schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vn-'));
    const db = openDatabase(join(dir, 'test.db'));
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toContain('notes');
    expect(tables).toContain('settings');
    expect(tables).toContain('schema_migrations');
    expect(tables).toContain('notes_fts');
  });
});
