import { db } from './db.js';
import { ApiError } from './util.js';

export function getDocOrThrow(id) {
  const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(id);
  if (!doc) throw new ApiError(404, 'NOT_FOUND', '规程不存在。');
  return doc;
}

export function getVersion(docId, versionNo) {
  const v = db
    .prepare('SELECT * FROM versions WHERE document_id=? AND version_no=?')
    .get(docId, versionNo);
  if (!v) throw new ApiError(404, 'NOT_FOUND', `版本 ${versionNo} 不存在。`);
  return v;
}

function userMap() {
  return new Map(
    db.prepare('SELECT id, username, display_name FROM users').all().map((u) => [
      u.id,
      { id: u.id, username: u.username, displayName: u.display_name },
    ])
  );
}

/** 组装某版本的完整展示数据：条款、沿革边、批注定位、签核 */
export function buildVersionPayload(doc, versionNo) {
  const v = getVersion(doc.id, versionNo);
  const creator = db.prepare('SELECT id, username, display_name FROM users WHERE id=?').get(v.created_by);
  const users = userMap();

  const clauses = db
    .prepare('SELECT id, ord, num, heading, body, content_hash AS contentHash FROM clauses WHERE version_id=? ORDER BY ord')
    .all(v.id);

  // 进入该版本的沿革边
  const edges = db
    .prepare(
      `SELECT old_clause_id AS oldClauseId, new_clause_id AS newClauseId,
              old_num AS oldNum, new_num AS newNum, relation
         FROM clause_lineage WHERE new_version_id=? ORDER BY rowid`
    )
    .all(v.id);

  // 批注定位
  const placed = db
    .prepare(
      `SELECT p.id AS placed_id, p.clause_id AS clauseId, p.clause_num AS clauseNum, p.status,
              a.id AS aid, a.author_id AS authorId, a.anchor_num AS anchorNum,
              a.anchor_quote AS anchorQuote, a.body, a.resolved, a.created_at
         FROM annotation_placed p JOIN annotations a ON a.id=p.annotation_id
        WHERE p.version_id=? ORDER BY a.created_at`
    )
    .all(v.id);
  const annotations = placed.map((p) => ({
    id: p.aid,
    placedId: p.placed_id,
    clauseId: p.clauseId,
    clauseNum: p.clauseNum,
    status: p.status,
    anchorNum: p.anchorNum,
    anchorQuote: p.anchorQuote,
    body: p.body,
    resolved: !!p.resolved,
    createdAt: p.created_at,
    author: users.get(p.authorId) || { id: p.authorId, username: '?', displayName: '未知用户' },
  }));

  // 签核按条款分组
  const signRows = db
    .prepare(
      `SELECT s.clause_id AS clauseId, s.clause_num AS clauseNum, s.user_id AS userId, s.created_at
         FROM signoffs s WHERE s.version_id=? ORDER BY s.created_at`
    )
    .all(v.id);
  const signoffs = {};
  for (const r of signRows) {
    if (!signoffs[r.clauseId]) signoffs[r.clauseId] = { clauseNum: r.clauseNum, users: [] };
    const u = users.get(r.userId) || { id: r.userId, username: '?', displayName: '未知用户' };
    signoffs[r.clauseId].users.push({ ...u, createdAt: r.created_at });
  }

  return {
    documentId: doc.id,
    title: doc.title,
    currentVersionNo: doc.current_no,
    isCurrent: versionNo === doc.current_no,
    version: {
      id: v.id,
      no: v.version_no,
      note: v.note,
      createdAt: v.created_at,
      creator: creator
        ? { id: creator.id, username: creator.username, displayName: creator.display_name }
        : null,
    },
    clauses,
    lineage: edges,
    annotations,
    signoffs,
  };
}

export function listVersions(docId) {
  return db
    .prepare(
      `SELECT v.version_no AS no, v.note, v.created_at AS createdAt,
              u.username, u.display_name AS displayName
         FROM versions v JOIN users u ON u.id=v.created_by
        WHERE v.document_id=? ORDER BY v.version_no`
    )
    .all(docId);
}

export function listLineage(docId) {
  return db
    .prepare(
      `SELECT l.old_version_id AS oldVersionId, l.new_version_id AS newVersionId,
              vo.version_no AS oldNo, vn.version_no AS newNo,
              l.old_num AS oldNum, l.new_num AS newNum, l.relation
         FROM clause_lineage l
         JOIN versions vn ON vn.id=l.new_version_id
    LEFT JOIN versions vo ON vo.id=l.old_version_id
        WHERE l.document_id=?
        ORDER BY vn.version_no, l.rowid`
    )
    .all(docId);
}
