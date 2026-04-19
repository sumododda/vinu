import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  sql: string;
}

export function runMigrations(db: Database.Database, migrations: Migration[]): void {
  const createMetaTable = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `;
  db.exec(createMetaTable);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (r) => r.version,
    ),
  );

  const pending = [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((m) => !applied.has(m.version));

  const insertStmt = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const m of pending) {
    const tx = db.transaction(() => {
      db.exec(m.sql);
      insertStmt.run(m.version, Date.now());
    });
    tx();
  }
}
