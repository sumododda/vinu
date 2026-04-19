import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './runner';

describe('migrations runner', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  it('creates schema_migrations table on first run', () => {
    runMigrations(db, [{ version: 1, sql: 'CREATE TABLE foo (id INTEGER PRIMARY KEY)' }]);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get();
    expect(row).toBeTruthy();
  });

  it('applies pending migrations in order and records them', () => {
    runMigrations(db, [
      { version: 1, sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' },
      { version: 2, sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY)' },
    ]);
    const versions = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('skips already-applied migrations', () => {
    runMigrations(db, [{ version: 1, sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' }]);
    runMigrations(db, [
      { version: 1, sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' },
      { version: 2, sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY)' },
    ]);
    const versions = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('runs each migration in a transaction (rollback on error)', () => {
    expect(() =>
      runMigrations(db, [
        { version: 1, sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY); SELECT bogus_function();' },
      ]),
    ).toThrow();
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='a'")
      .get();
    expect(row).toBeFalsy();
  });
});
