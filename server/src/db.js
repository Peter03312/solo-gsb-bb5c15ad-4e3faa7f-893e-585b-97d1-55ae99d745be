import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  current_no  INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS versions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no  INTEGER NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, version_no)
);

CREATE TABLE IF NOT EXISTS clauses (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id  TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  ord         INTEGER NOT NULL,
  num         TEXT NOT NULL,
  heading     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE (version_id, num)
);

-- 相邻版本编号沿革：每条边表示 old 版本条款到 new 版本条款的关系
CREATE TABLE IF NOT EXISTS clause_lineage (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  old_version_id TEXT REFERENCES versions(id) ON DELETE CASCADE,
  new_version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  old_clause_id  TEXT,
  new_clause_id  TEXT,
  old_num      TEXT,
  new_num      TEXT,
  -- unchanged | renumbered | modified | split_from | merged_into | deleted | created
  relation     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS annotations (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id),
  anchor_num  TEXT NOT NULL,
  anchor_quote TEXT NOT NULL,   -- 原文片段
  body        TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 批注在某一版本条款上的定位
CREATE TABLE IF NOT EXISTS annotation_placed (
  id            TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  version_id    TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  clause_id     TEXT REFERENCES clauses(id) ON DELETE CASCADE,
  clause_num    TEXT NOT NULL,
  -- anchored | pending | deleted_history
  status        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signoffs (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id  TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  clause_id   TEXT REFERENCES clauses(id) ON DELETE CASCADE,
  clause_num  TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (version_id, clause_id, user_id)
);

CREATE TABLE IF NOT EXISTS revision_drafts (
  document_id   TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  base_version_no INTEGER NOT NULL,
  data_json     TEXT NOT NULL,
  updated_by    TEXT NOT NULL REFERENCES users(id),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clauses_version ON clauses(version_id);
CREATE INDEX IF NOT EXISTS idx_lineage_doc ON clause_lineage(document_id);
CREATE INDEX IF NOT EXISTS idx_placed_annotation ON annotation_placed(annotation_id);
CREATE INDEX IF NOT EXISTS idx_placed_version ON annotation_placed(version_id);
CREATE INDEX IF NOT EXISTS idx_signoffs_version ON signoffs(version_id);
`);
