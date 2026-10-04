import Database from 'better-sqlite3';
import { randomBytes, scryptSync, randomUUID, timingSafeEqual } from 'node:crypto';

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  credential   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no  INTEGER NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  UNIQUE (doc_id, version_no)
);

-- 条款按版本快照存储：同一逻辑条款在不同版本各占一行，沿革由 clause_lineage 表达。
CREATE TABLE IF NOT EXISTS clauses (
  id           TEXT PRIMARY KEY,
  doc_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id   TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  ord          INTEGER NOT NULL,
  num          TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL
);

-- 相邻版本间的编号沿革（条款级 DAG 边）。
-- relation: added | deleted | unchanged | modified | split | merged
-- from/to 均可空：added 只有 to；deleted 只有 from。
CREATE TABLE IF NOT EXISTS clause_lineage (
  id              TEXT PRIMARY KEY,
  doc_id          TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  from_version_no INTEGER,
  to_version_no   INTEGER,
  from_clause_id  TEXT REFERENCES clauses(id),
  to_clause_id    TEXT REFERENCES clauses(id),
  from_num        TEXT,
  to_num          TEXT,
  relation        TEXT NOT NULL
);

-- 批注按版本快照存储，同一串讨论用 thread_id 串联，便于在历史版本中原样保留。
-- status: active（已定位）| pending（待重新定位）| archived（条款删除，留存历史）
CREATE TABLE IF NOT EXISTS annotations (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  doc_id      TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id  TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  clause_id   TEXT REFERENCES clauses(id),
  author_id   TEXT NOT NULL REFERENCES users(id),
  quote       TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL,
  status      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 签核同样按版本快照；unchanged 后继继承（inherited=1），当前版本可直接签（inherited=0）。
CREATE TABLE IF NOT EXISTS signoffs (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id  TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  clause_id   TEXT NOT NULL REFERENCES clauses(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  inherited   INTEGER NOT NULL DEFAULT 0,
  signed_at   TEXT NOT NULL,
  UNIQUE (version_id, clause_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_clauses_version ON clauses(version_id, ord);
CREATE INDEX IF NOT EXISTS idx_lineage_doc     ON clause_lineage(doc_id);
CREATE INDEX IF NOT EXISTS idx_ann_version     ON annotations(version_id);
CREATE INDEX IF NOT EXISTS idx_signoff_clause  ON signoffs(clause_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
`;

export function newId() {
  return randomUUID();
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = scryptSync(password, salt, 64).toString('hex');
  return { salt, credential: `${salt}:${derived}` };
}

export function verifyPassword(password, credential) {
  const [salt, expected] = credential.split(':');
  const actual = scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expected, 'hex');
  return expectedBuf.length === actual.length && timingSafeEqual(expectedBuf, actual);
}

export function initDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const { credential } = hashPassword(password);
    db.prepare(
      `INSERT INTO users (id, username, display_name, credential, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(newId(), username, '管理员', credential, new Date().toISOString());
    console.log(`[init] 已创建初始管理员: ${username}（请尽快通过 ADMIN_PASSWORD 修改默认口令）`);
  }
  return db;
}
