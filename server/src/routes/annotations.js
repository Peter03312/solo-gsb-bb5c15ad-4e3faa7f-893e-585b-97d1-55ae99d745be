import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { ApiError, wrap } from '../util.js';
import { authRequired } from '../auth.js';
import { getDocOrThrow, getVersion, buildVersionPayload } from '../docService.js';
import { countOccurrences } from '../lineage.js';

const router = Router();
router.use(authRequired);

// 在当前版本的某条款上添加批注（须锚定真实原文片段）
router.post(
  '/docs/:docId',
  wrap((req, res) => {
    const doc = getDocOrThrow(req.params.docId);
    const clauseId = String(req.body.clauseId || '');
    const quote = String(req.body.quote || '').trim();
    const body = String(req.body.body || '').trim();
    if (!body) throw new ApiError(400, 'BAD_INPUT', '批注内容不能为空。');
    if (!quote) throw new ApiError(400, 'BAD_INPUT', '批注必须锚定原文片段。');

    const ver = db.prepare('SELECT * FROM versions WHERE id=(SELECT id FROM versions WHERE document_id=? ORDER BY version_no DESC LIMIT 1)').get(doc.id);
    const clause = db.prepare('SELECT * FROM clauses WHERE id=? AND version_id=?').get(clauseId, ver.id);
    if (!clause) throw new ApiError(404, 'CLAUSE_NOT_FOUND', '锚定的条款不存在或已不是当前版本，请刷新后重试。');

    const hits = countOccurrences(`${clause.heading}\n${clause.body}`, quote);
    if (hits === 0) throw new ApiError(422, 'QUOTE_NOT_FOUND', '所选片段与条款原文不一致，无法锚定。');
    if (hits > 1) throw new ApiError(422, 'QUOTE_NOT_UNIQUE', '所选片段在条款中出现多次，请扩大选区以保证唯一匹配。');

    const annId = nanoid(14);
    db.transaction(() => {
      db.prepare(
        'INSERT INTO annotations (id,document_id,author_id,anchor_num,anchor_quote,body) VALUES (?,?,?,?,?,?)'
      ).run(annId, doc.id, req.user.id, clause.num, quote, body);
      db.prepare(
        'INSERT INTO annotation_placed (id,annotation_id,version_id,clause_id,clause_num,status) VALUES (?,?,?,?,?,?)'
      ).run(nanoid(14), annId, ver.id, clause.id, clause.num, 'anchored');
    })();

    res.status(201).json(buildVersionPayload(doc, doc.current_no));
  })
);

// 标记解决/恢复
router.post(
  '/:annotationId/resolve',
  wrap((req, res) => {
    const ann = db.prepare('SELECT * FROM annotations WHERE id=?').get(req.params.annotationId);
    if (!ann) throw new ApiError(404, 'NOT_FOUND', '批注不存在。');
    const resolved = req.body.resolved === false ? 0 : 1;
    db.prepare('UPDATE annotations SET resolved=? WHERE id=?').run(resolved, ann.id);
    res.json({ ok: true });
  })
);

// 待重新定位的批注：手动重新锚定到当前版本条款（片段须在目标条款中唯一匹配）
router.post(
  '/:annotationId/relocate',
  wrap((req, res) => {
    const ann = db.prepare('SELECT * FROM annotations WHERE id=?').get(req.params.annotationId);
    if (!ann) throw new ApiError(404, 'NOT_FOUND', '批注不存在。');
    const doc = getDocOrThrow(ann.document_id);
    const targetClauseId = String(req.body.clauseId || '');
    const quote = String(req.body.quote || ann.anchor_quote).trim();

    const ver = getVersion(doc.id, doc.current_no);
    const clause = db.prepare('SELECT * FROM clauses WHERE id=? AND version_id=?').get(targetClauseId, ver.id);
    if (!clause) throw new ApiError(404, 'CLAUSE_NOT_FOUND', '目标条款不存在，请基于当前版本重新选择。');

    const hits = countOccurrences(`${clause.heading}\n${clause.body}`, quote);
    if (hits === 0) throw new ApiError(422, 'QUOTE_NOT_FOUND', '片段在目标条款原文中找不到。');
    if (hits > 1) throw new ApiError(422, 'QUOTE_NOT_UNIQUE', '片段在目标条款中不唯一，请扩大选区。');

    db.transaction(() => {
      const cur = db
        .prepare('SELECT * FROM annotation_placed WHERE annotation_id=? AND version_id=?')
        .get(ann.id, ver.id);
      if (!cur) throw new ApiError(409, 'VERSION_MOVED', '版本已变化，请刷新后重新定位。');
      if (cur.status !== 'pending') throw new ApiError(400, 'NOT_PENDING', '该批注不处于待重新定位状态。');
      db.prepare('UPDATE annotation_placed SET clause_id=?,clause_num=?,status=? WHERE id=?').run(
        clause.id, clause.num, 'anchored', cur.id
      );
      db.prepare('UPDATE annotations SET anchor_num=?, anchor_quote=? WHERE id=?').run(
        clause.num, quote, ann.id
      );
    })();

    res.json(buildVersionPayload(doc, doc.current_no));
  })
);

export default router;
