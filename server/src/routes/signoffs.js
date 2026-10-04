import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { ApiError, wrap } from '../util.js';
import { authRequired } from '../auth.js';
import { getDocOrThrow, getVersion, buildVersionPayload } from '../docService.js';

const router = Router();
router.use(authRequired);

// 对当前版本的某条款签核（新版本提交时，仅内容未变的一对一后继自动继承）
router.post(
  '/docs/:docId/clauses/:clauseId',
  wrap((req, res) => {
    const doc = getDocOrThrow(req.params.docId);
    const ver = getVersion(doc.id, doc.current_no);
    const clause = db
      .prepare('SELECT id,num FROM clauses WHERE id=? AND version_id=?')
      .get(req.params.clauseId, ver.id);
    if (!clause) throw new ApiError(404, 'CLAUSE_NOT_FOUND', '条款不存在或已不是当前版本，请刷新。');

    db.prepare(
      `INSERT OR IGNORE INTO signoffs (id,document_id,version_id,clause_id,clause_num,user_id)
       VALUES (?,?,?,?,?,?)`
    ).run(nanoid(14), doc.id, ver.id, clause.id, clause.num, req.user.id);

    res.json(buildVersionPayload(doc, doc.current_no));
  })
);

// 撤回自己的签核
router.delete(
  '/docs/:docId/clauses/:clauseId',
  wrap((req, res) => {
    const doc = getDocOrThrow(req.params.docId);
    const ver = getVersion(doc.id, doc.current_no);
    db.prepare(
      'DELETE FROM signoffs WHERE version_id=? AND clause_id=? AND user_id=?'
    ).run(ver.id, req.params.clauseId, req.user.id);
    res.json(buildVersionPayload(doc, doc.current_no));
  })
);

export default router;
