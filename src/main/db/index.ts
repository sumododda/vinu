import Database from 'better-sqlite3';
import { runMigrations, type Migration } from './runner';
import initSql from './migrations/001_init.sql?raw';
import foldersSql from './migrations/002_folders_inline.sql?raw';
import folderTreeSql from './migrations/003_folder_tree.sql?raw';

export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const migrations: Migration[] = [
    { version: 1, sql: initSql },
    { version: 2, sql: foldersSql },
    { version: 3, sql: folderTreeSql },
  ];
  runMigrations(db, migrations);
  return db;
}
