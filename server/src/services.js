import { initDb, newId, hashPassword } from './db.js';
import {
  parseClauses,
  contentHash,
  quoteOccurrences,
} from './util.js';
import { computeLineage, deriveSources } from './lineage.js';

const db = initDb(process.env.DB_PATH || '/data/collation.db');

const now = () => new Date().toISOString();

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/* ---------------- 文档与版本 ---------------- */

export function getDocOrThrow(docId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId);
  if (!doc) throw new ApiError(404, 'not_found', '文档不存在');
  return doc;
}

function insertClausesTx(tx, versionId, docId, parsed) {
  const insertClause = tx.prepare(
    `INSERT INTO clauses (id, doc_id, version_id, ord, num, title, body, content_hash)
     VALUES (@id, @doc_id, @version_id, @ord, @num, @title, @body, @content_hash)`
  );
  parsed.clauses.forEach((c, i) => {
    insertClause.run({
      id: newId(),
      doc_id: docId,
      version_id: versionId,
      ord: i,
      num: c.num,
      title: c.title,
      body: c.body,
      content_hash: contentHash(c.title, c.body),
    });
  });
}

function validateReferences(parsed, versionNo) {
  const errors = [];
  const nums = new Set(parsed.clauses.map((c) => c.num));
  const missing = new Map();
  for (const ref of parsed.references) {
    if (!nums.has(ref.num)) {
      if (!missing.has(ref.num)) missing.set(ref.num, new Set());
      missing.get(ref.num).add(ref.clauseNum);
    }
  }
  for (const [num, where] of missing) {
    errors.push(`引用了不存在的条款「${num}」（出现在条款 ${[...where].join('、')}，版本 v${versionNo}）`);
  }
  return errors;
}

/** 导入首版（v1）。 */
export function createDocument({ title, markdown, userId }) {
  if (!title || !title.trim()) throw new ApiError(400, 'bad_request', '文档标题不能为空');
  const parsed = parseClauses(markdown);
  if (parsed.errors.length) throw new ApiError(422, 'invalid_markdown', 'Markdown 解析失败', { errors: parsed.errors });
  const refErrors = validateReferences(parsed, 1);
  if (refErrors.length) throw new ApiError(422, 'invalid_references', '条款引用校验失败', { errors: refErrors });

  const docId = newId();
  const versionId = newId();
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO documents (id, title, created_by, created_at) VALUES (?,?,?,?)')
      .run(docId, title.trim(), userId, ts);
    db.prepare(
      `INSERT INTO versions (id, doc_id, version_no, message, created_by, created_at)
       VALUES (?,?,?,?,?,?)`
    ).run(versionId, docId, 1, '初始导入', userId, ts);
    insertClausesTx(db, versionId, docId, parsed);
    // v1 自身在沿革图中的起点
    const rows = db.prepare('SELECT id, num FROM clauses WHERE version_id = ? ORDER BY ord').all(versionId);
    const insEdge = db.prepare(
      `INSERT INTO clause_lineage (id, doc_id, from_version_no, to_version_no,
        from_clause_id, to_clause_id, from_num, to_num, relation)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    for (const r of rows) {
      insEdge.run(newId(), docId, null, 1, null, r.id, null, r.num, 'added');
    }
  });
  tx();
  return { docId, versionId, versionNo: 1 };
}

/**
 * 提交修订：乐观并发控制。
 * baseVersionNo 必须等于当前最新版本号，否则以 409 返回当前版本供重新处理，绝不静默覆盖。
 * sourceMap: { 新版本条款编号: [旧版本 clauseId ...] }，用于表达拆分/合并；缺省按编号一对一推断。
 */
export function createRevision({ docId, baseVersionNo, markdown, message, sourceMap, userId }) {
  const doc = getDocOrThrow(docId);
  const latest = db.prepare('SELECT MAX(version_no) AS n FROM versions WHERE doc_id = ?').get(docId).n;
  const base = Number.isInteger(baseVersionNo) ? baseVersionNo : Number(baseVersionNo);
  if (!Number.isInteger(base)) throw new ApiError(400, 'bad_request', '必须提供整数基准版本号 baseVersionNo');
  if (base !== latest) {
    throw new ApiError(409, 'version_conflict',
      `版本冲突：您基于 v${base} 修订，当前最新版本已为 v${latest}。请取回当前版本重新处理后再次提交。`,
      { currentVersion: buildVersionPayload(docId, latest) });
  }

  const parsed = parseClauses(markdown);
  if (parsed.errors.length) throw new ApiError(422, 'invalid_markdown', 'Markdown 解析失败', { errors: parsed.errors });
  const newNo = latest + 1;
  const refErrors = validateReferences(parsed, newNo);
  if (refErrors.length) throw new ApiError(422, 'invalid_references', '条款引用校验失败', { errors: refErrors });

  const oldClauses = db.prepare('SELECT * FROM clauses WHERE version_id = (SELECT id FROM versions WHERE doc_id=? AND version_no=?) ORDER BY ord')
    .all(docId, latest);
  const oldById = new Map(oldClauses.map((c) => [c.id, c]));

  // 新版本条款：预先分配真实条款 ID 与内容指纹，沿革边直接引用这些 ID。
  const newClauses = parsed.clauses.map((c) => ({
    ...c,
    id: newId(),
    content_hash: contentHash(c.title, c.body),
    sources: sourceMap?.[c.num] ? [...sourceMap[c.num]] : null,
  }));
  deriveSources(oldClauses, newClauses);
  const { edges, errors: lineageErrors } = computeLineage(oldClauses, newClauses);
  if (lineageErrors.length) throw new ApiError(422, 'invalid_lineage', '沿革来源校验失败', { errors: lineageErrors });

  const versionId = newId();
  const ts = now();
  const numToNewId = new Map(newClauses.map((c) => [c.num, c.id]));

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO versions (id, doc_id, version_no, message, created_by, created_at)
       VALUES (?,?,?,?,?,?)`
    ).run(versionId, docId, newNo, (message || '').trim(), userId, ts);

    const insClause = db.prepare(
      `INSERT INTO clauses (id, doc_id, version_id, ord, num, title, body, content_hash)
       VALUES (@id, @doc_id, @version_id, @ord, @num, @title, @body, @content_hash)`
    );
    newClauses.forEach((c, i) => {
      insClause.run({
        id: c.id, doc_id: docId, version_id: versionId, ord: i,
        num: c.num, title: c.title, body: c.body, content_hash: c.content_hash,
      });
    });

    const insEdge = db.prepare(
      `INSERT INTO clause_lineage (id, doc_id, from_version_no, to_version_no,
        from_clause_id, to_clause_id, from_num, to_num, relation)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    for (const e of edges) {
      insEdge.run(newId(), docId, latest, newNo, e.from, e.to, e.fromNum, e.toNum, e.relation);
    }

    propagateAnnotations(docId, versionId, latest, oldClauses, newClauses, numToNewId, edges, ts);
    propagateSignoffs(versionId, docId, edges, numToNewId, ts);
  });
  tx();
  return { docId, versionId, versionNo: newNo };
}

function propagateAnnotations(docId, newVersionId, oldVersionNo, oldClauses, newClauses, numToNewId, edges, ts) {
  const oldVersion = db.prepare('SELECT id FROM versions WHERE doc_id = ? AND version_no = ?').get(docId, oldVersionNo);
  const oldAnns = db.prepare('SELECT * FROM annotations WHERE version_id = ?').all(oldVersion.id);

  // 从边构造映射
  const incoming = new Map(); // oldClauseId -> [{newClause, relation}]
  const outgoing = new Map(); // newClauseNum -> [{oldClause, relation}]
  for (const e of edges) {
    if (e.from && e.to) {
      if (!incoming.has(e.from)) incoming.set(e.from, []);
      incoming.get(e.from).push({ newNum: e.toNum, relation: e.relation });
      if (!outgoing.has(e.toNum)) outgoing.set(e.toNum, []);
      outgoing.get(e.toNum).push({ oldClauseId: e.from, relation: e.relation });
    }
  }
  const newByNum = new Map(newClauses.map((c) => [c.num, c]));
  const oldById = new Map(oldClauses.map((c) => [c.id, c]));

  const insAnn = db.prepare(
    `INSERT INTO annotations (id, thread_id, doc_id, version_id, clause_id, author_id,
      quote, content, status, created_at, updated_at)
     VALUES (@id, @thread_id, @doc_id, @version_id, @clause_id, @author_id,
      @quote, @content, @status, @created_at, @updated_at)`
  );

  for (const a of oldAnns) {
    const base = {
      thread_id: a.thread_id,
      doc_id: docId,
      version_id: newVersionId,
      author_id: a.author_id,
      quote: a.quote,
      content: a.content,
      created_at: ts,
      updated_at: ts,
    };

    if (a.status === 'archived') {
      // 删除条款的批注留在历史版本，不再向新版本传播。
      continue;
    }

    // pending（上一版待定位）：若其旧条款仍有后继，尝试用片段在后继中重新定位
    const rels = a.clause_id ? incoming.get(a.clause_id) : null;

    if (!rels) {
      if (a.status === 'active') {
        // 条款被删除：批注留存到上一历史版本（不复制），此处无需操作。
      }
      // pending 且旧条款已删除：批注失去依附，仅留在历史版本。
      continue;
    }

    for (const rel of rels) {
      const nc = newByNum.get(rel.newNum);
      const newClauseId = numToNewId.get(rel.newNum);
      let status;
      if (rel.relation === 'unchanged' && a.status === 'active') {
        status = 'active'; // 仅换序/换编号、内容未变：沿用定位
      } else if (rel.relation === 'unchanged' && a.status === 'pending') {
        // 内容未变，用上一版人工重定位/原片段再校验一次唯一性
        const hits = quoteOccurrences(nc.title, nc.body, a.quote);
        status = hits === 1 ? 'active' : 'pending';
      } else {
        // 内容改变（modified）、拆分（split）、合并（merged）：一律列为待重新定位，
        // 即便原片段仍在后继条款中出现，也要求人工确认，避免锚到错误位置。
        status = 'pending';
      }
      insAnn.run({ id: newId(), ...base, clause_id: newClauseId, status });
    }
  }
}

function propagateSignoffs(newVersionId, docId, edges, numToNewId, ts) {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO signoffs (id, doc_id, version_id, clause_id, user_id, inherited, signed_at)
     VALUES (?,?,?,?,?,?,?)`
  );
  for (const e of edges) {
    if (e.relation !== 'unchanged' || !e.from || !e.to) continue;
    const prior = db.prepare('SELECT user_id FROM signoffs WHERE clause_id = ?').all(e.from);
    for (const p of prior) {
      ins.run(newId(), docId, newVersionId, numToNewId.get(e.toNum), p.user_id, 1, ts);
    }
  }
}

/* ---------------- 读取 ---------------- */

const USER_COLS = `SELECT id, username, display_name FROM users`;

export function listDocuments() {
  return db.prepare(`
    SELECT d.*, MAX(v.version_no) AS latest_version, COUNT(v.id) AS version_count
    FROM documents d LEFT JOIN versions v ON v.doc_id = d.id
    GROUP BY d.id ORDER BY d.created_at DESC`).all();
}

export function listVersions(docId) {
  getDocOrThrow(docId);
  return db.prepare(`
    SELECT v.id, v.version_no, v.message, v.created_at, v.created_by,
           u.display_name AS author_name,
           (SELECT COUNT(*) FROM clauses c WHERE c.version_id = v.id) AS clause_count
    FROM versions v JOIN users u ON u.id = v.created_by
    WHERE v.doc_id = ? ORDER BY v.version_no`).all(docId);
}

export function buildVersionPayload(docId, versionNo) {
  const doc = getDocOrThrow(docId);
  const version = db.prepare(`
    SELECT v.*, u.display_name AS author_name FROM versions v
    JOIN users u ON u.id = v.created_by
    WHERE v.doc_id = ? AND v.version_no = ?`).get(docId, versionNo);
  if (!version) throw new ApiError(404, 'not_found', `版本 v${versionNo} 不存在`);

  const latest = db.prepare('SELECT MAX(version_no) AS n FROM versions WHERE doc_id = ?').get(docId).n;
  const clauses = db.prepare('SELECT * FROM clauses WHERE version_id = ? ORDER BY ord').all(version.id);
  const anns = db.prepare(`
    SELECT a.*, u.display_name AS author_name FROM annotations a
    JOIN users u ON u.id = a.author_id WHERE a.version_id = ?`).all(version.id);
  const signs = db.prepare(`
    SELECT s.*, u.display_name AS user_name FROM signoffs s
    JOIN users u ON u.id = s.user_id WHERE s.version_id = ?`).all(version.id);

  const annByClause = new Map();
  const pending = [];
  for (const a of anns) {
    if (a.status === 'pending') pending.push(a);
    if (a.clause_id) {
      if (!annByClause.has(a.clause_id)) annByClause.set(a.clause_id, []);
      annByClause.get(a.clause_id).push(a);
    }
  }
  const signByClause = new Map();
  for (const s of signs) {
    if (!signByClause.has(s.clause_id)) signByClause.set(s.clause_id, []);
    signByClause.get(s.clause_id).push(s);
  }

  return {
    document: { id: doc.id, title: doc.title },
    version: {
      id: version.id,
      versionNo: version.version_no,
      message: version.message,
      createdAt: version.created_at,
      authorName: version.author_name,
      isLatest: version.version_no === latest,
    },
    latestVersionNo: latest,
    clauses: clauses.map((c) => ({
      id: c.id, ord: c.ord, num: c.num, title: c.title, body: c.body,
      annotations: annByClause.get(c.id) || [],
      signoffs: signByClause.get(c.id) || [],
    })),
    pendingAnnotations: pending,
  };
}

/** 某条款的编号沿革链：沿相邻版本边 BFS，展示 added/unchanged/modified/split/merged/deleted。 */
export function getClauseHistory(clauseId) {
  const start = db.prepare('SELECT * FROM clauses WHERE id = ?').get(clauseId);
  if (!start) throw new ApiError(404, 'not_found', '条款不存在');
  const edges = db.prepare('SELECT * FROM clause_lineage WHERE doc_id = ? ORDER BY to_version_no, from_version_no')
    .all(start.doc_id);

  const steps = [];
  const queue = [{ clauseId: start.id, num: start.num }];
  const seenEdge = new Set();

  // 向前追溯（旧版本）
  let frontier = queue;
  while (frontier.length) {
    const next = [];
    for (const node of frontier) {
      for (const e of edges) {
        if (e.to_clause_id === node.clauseId && !seenEdge.has(e.id)) {
          seenEdge.add(e.id);
          steps.unshift({
            fromVersionNo: e.from_version_no, toVersionNo: e.to_version_no,
            fromNum: e.from_num, toNum: e.to_num, relation: e.relation,
          });
          if (e.from_clause_id) {
            const fc = db.prepare('SELECT num FROM clauses WHERE id = ?').get(e.from_clause_id);
            next.push({ clauseId: e.from_clause_id, num: fc?.num });
          }
        }
      }
    }
    frontier = next;
  }
  // 向后推进（新版本）
  frontier = [{ clauseId: start.id }];
  while (frontier.length) {
    const next = [];
    for (const node of frontier) {
      for (const e of edges) {
        if (e.from_clause_id === node.clauseId && !seenEdge.has(e.id)) {
          seenEdge.add(e.id);
          steps.push({
            fromVersionNo: e.from_version_no, toVersionNo: e.to_version_no,
            fromNum: e.from_num, toNum: e.to_num, relation: e.relation,
          });
          if (e.to_clause_id) next.push({ clauseId: e.to_clause_id });
        }
      }
    }
    frontier = next;
  }

  // 以起始条款为中心，steps 已覆盖其在相邻版本间的全部沿革边（split/merge 会有多条）。
  return {
    clause: { id: start.id, num: start.num, title: start.title },
    anchorVersionNo: db.prepare('SELECT version_no FROM versions WHERE id = ?').get(start.version_id).version_no,
    steps: steps.sort((a, b) => (a.toVersionNo ?? a.fromVersionNo) - (b.toVersionNo ?? b.fromVersionNo)),
  };
}

/* ---------------- 批注 ---------------- */

export function createAnnotation({ versionId, clauseId, quote, content, userId }) {
  const version = db.prepare(`SELECT * FROM versions WHERE id = ?`).get(versionId);
  if (!version) throw new ApiError(404, 'not_found', '版本不存在');
  const latest = db.prepare('SELECT MAX(version_no) AS n FROM versions WHERE doc_id = ?').get(version.doc_id).n;
  if (version.version_no !== latest) {
    throw new ApiError(409, 'historical_version', '只能在最新版本上添加批注；历史版本仅供查看。');
  }
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ? AND version_id = ?').get(clauseId, versionId);
  if (!clause) throw new ApiError(422, 'bad_clause', '批注锚定的条款不属于该版本');
  if (!content || !content.trim()) throw new ApiError(400, 'bad_request', '批注内容不能为空');

  const hits = quoteOccurrences(clause.title, clause.body, quote || '');
  if (hits === 0) throw new ApiError(422, 'quote_not_found', '原文片段在该条款中不存在，无法锚定');
  if (hits > 1) throw new ApiError(422, 'quote_ambiguous', `原文片段在该条款中出现 ${hits} 次，无法唯一匹配，请选取更长的片段`);

  const ts = now();
  const id = newId();
  db.prepare(
    `INSERT INTO annotations (id, thread_id, doc_id, version_id, clause_id, author_id,
      quote, content, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, newId(), version.doc_id, versionId, clauseId, userId, quote || '', content.trim(), 'active', ts, ts);
  return { id };
}

/** 把待重新定位的批注重新锚定到指定条款/片段。 */
export function relocateAnnotation({ annotationId, clauseId, quote, userId }) {
  const ann = db.prepare('SELECT * FROM annotations WHERE id = ?').get(annotationId);
  if (!ann) throw new ApiError(404, 'not_found', '批注不存在');
  if (ann.status !== 'pending') throw new ApiError(409, 'not_pending', '只有待重新定位的批注可以重新锚定');
  const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(ann.version_id);
  const latest = db.prepare('SELECT MAX(version_no) AS n FROM versions WHERE doc_id = ?').get(ann.doc_id).n;
  if (version.version_no !== latest) throw new ApiError(409, 'historical_version', '该待定位批注已属于历史版本，不能再修改');

  const clause = db.prepare('SELECT * FROM clauses WHERE id = ? AND version_id = ?').get(clauseId, ann.version_id);
  if (!clause) throw new ApiError(422, 'bad_clause', '目标条款不属于该版本');
  const hits = quoteOccurrences(clause.title, clause.body, quote || ann.quote);
  if (hits === 0) throw new ApiError(422, 'quote_not_found', '原文片段在目标条款中不存在');
  if (hits > 1) throw new ApiError(422, 'quote_ambiguous', '原文片段在目标条款中出现多次，无法唯一匹配');

  db.prepare('UPDATE annotations SET clause_id = ?, quote = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(clauseId, quote || ann.quote, 'active', now(), annotationId);
  return { ok: true };
}

/* ---------------- 签核 ---------------- */

export function signoff({ versionId, clauseId, userId }) {
  const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId);
  if (!version) throw new ApiError(404, 'not_found', '版本不存在');
  const latest = db.prepare('SELECT MAX(version_no) AS n FROM versions WHERE doc_id = ?').get(version.doc_id).n;
  if (version.version_no !== latest) throw new ApiError(409, 'historical_version', '只能签核最新版本的条款；历史版本仅供查看');
  const clause = db.prepare('SELECT * FROM clauses WHERE id = ? AND version_id = ?').get(clauseId, versionId);
  if (!clause) throw new ApiError(422, 'bad_clause', '条款不属于该版本');
  db.prepare(
    `INSERT OR IGNORE INTO signoffs (id, doc_id, version_id, clause_id, user_id, inherited, signed_at)
     VALUES (?,?,?,?,?,0,?)`
  ).run(newId(), version.doc_id, versionId, clauseId, userId, now());
  return { ok: true };
}

export function unsignoff({ versionId, clauseId, userId }) {
  db.prepare('DELETE FROM signoffs WHERE version_id = ? AND clause_id = ? AND user_id = ? AND inherited = 0')
    .run(versionId, clauseId, userId);
  return { ok: true };
}

/* ---------------- 鉴权与用户 ---------------- */

export function login({ username, password }, verifyPassword) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.credential)) {
    throw new ApiError(401, 'unauthorized', '用户名或密码错误');
  }
  const token = newId().replace(/-/g, '');
  const ts = now();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, user.id, ts, expires);
  return { token, user: { id: user.id, username: user.username, displayName: user.display_name } };
}

export function getUserByToken(token) {
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`).get(token, now());
  return row || null;
}

export function register({ username, password, displayName }) {
  if (!/^[A-Za-z0-9_\-]{2,32}$/.test(username || '')) {
    throw new ApiError(400, 'bad_request', '用户名需为 2-32 位字母、数字、下划线或连字符');
  }
  if (!password || password.length < 6) throw new ApiError(400, 'bad_request', '密码至少 6 位');
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) throw new ApiError(409, 'user_exists', '用户名已存在');
  const { credential } = hashPassword(password);
  const id = newId();
  db.prepare('INSERT INTO users (id, username, display_name, credential, created_at) VALUES (?,?,?,?,?)')
    .run(id, username, displayName || username, credential, now());
  return { id };
}

export function listUsers() {
  return db.prepare(`${USER_COLS} ORDER BY username`).all();
}

export { ApiError };
