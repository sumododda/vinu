ALTER TABLE folders ADD COLUMN parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX folders_parent_id_idx ON folders (parent_id, name);
