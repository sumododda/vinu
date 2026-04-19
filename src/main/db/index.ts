import Database from 'better-sqlite3';
import { runMigrations, type Migration } from './runner';
import initSql from './migrations/001_init.sql?raw';

export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const migrations: Migration[] = [{ version: 1, sql: initSql }];
  runMigrations(db, migrations);
  return db;
}
