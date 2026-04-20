CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  name       TEXT NOT NULL COLLATE NOCASE UNIQUE
);

ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE notes ADD COLUMN search_text TEXT NOT NULL DEFAULT '';

UPDATE notes SET search_text = markdown WHERE search_text = '';

DROP TRIGGER IF EXISTS notes_ai;
DROP TRIGGER IF EXISTS notes_ad;
DROP TRIGGER IF EXISTS notes_au;
DROP TABLE IF EXISTS notes_fts;

CREATE INDEX notes_folder_id_idx ON notes (folder_id, created_at DESC);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, search_text, transcript,
  content='notes', content_rowid='rowid',
  tokenize='porter unicode61'
);

INSERT INTO notes_fts(rowid, title, search_text, transcript)
SELECT rowid, title, search_text, transcript FROM notes;

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, search_text, transcript)
  VALUES (new.rowid, new.title, new.search_text, new.transcript);
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, search_text, transcript)
  VALUES ('delete', old.rowid, old.title, old.search_text, old.transcript);
END;

CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, search_text, transcript)
  VALUES ('delete', old.rowid, old.title, old.search_text, old.transcript);
  INSERT INTO notes_fts(rowid, title, search_text, transcript)
  VALUES (new.rowid, new.title, new.search_text, new.transcript);
END;
