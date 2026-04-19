PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE notes (
  id            TEXT PRIMARY KEY,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  markdown      TEXT NOT NULL DEFAULT '',
  transcript    TEXT NOT NULL DEFAULT '',
  audio_path    TEXT,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN (
                  'transcribing','generating','ready',
                  'transcription_failed','generation_failed','pending_network')),
  error_message TEXT,
  model_used    TEXT,
  provider      TEXT
);

CREATE INDEX notes_created_at_idx ON notes (created_at DESC);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, markdown, transcript,
  content='notes', content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, markdown, transcript)
  VALUES (new.rowid, new.title, new.markdown, new.transcript);
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, markdown, transcript)
  VALUES ('delete', old.rowid, old.title, old.markdown, old.transcript);
END;

CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, markdown, transcript)
  VALUES ('delete', old.rowid, old.title, old.markdown, old.transcript);
  INSERT INTO notes_fts(rowid, title, markdown, transcript)
  VALUES (new.rowid, new.title, new.markdown, new.transcript);
END;

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
