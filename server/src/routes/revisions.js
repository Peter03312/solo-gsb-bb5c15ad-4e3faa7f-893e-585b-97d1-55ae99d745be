import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { ApiError, wrap, sha256 } from '../util.js';
import { authRequired } from '../auth.js';
import { parseMarkdown, extractReferences } from '../markdown.js';
import { computeLineage, locateAnnotation, signoffInheritable } from '../lineage.js';
import { buildVersionPayload, getDocOrThrow } from '../docService.js';

const router = Router();
router.use(authRequired);

const hashOf = (heading, body) => sha256(`${String(heading || '').trim()}\n\n${String(body || '').trim()}`);

// 解析预览：不写库
router.post('/parse', (req, res) => {
  const parsed = parseMarkdown(String(req.body.markdown || ''));
  res.json(parsed);
});

// 读取草稿
router.get(
  '/drafts/:docId',
  wrap((req, res) => {
    getDocOrThrow(req.params.docId);
    const row = db.prepare('SELECT * FROM revision_drafts WHERE document_id=?').get(req.params.docId);
    if (!row) return res.json({ draft: null });
    res.json({
      draft: {
        baseVersionNo: row.base_version_no,
        data: JSON.parse(row.data_json),
        updatedBy: row.updated_by,
        updatedAt: row.updated_at,
      },
    });
  })
);

// 保存草稿（保存本身不产生新版本；草稿过期也允许，但会附带当前版本号供提示）
router.put(
  '/drafts/:docId',
  wrap((req, res) => {
    const doc = getDocOrThrow(req.params.docId);
    const baseNo = Math.trunc(Number(req.body.baseVersionNo));
    const data = req.body.data;
    if (!data || !Array.isArray(data.rows)) throw new ApiError(400, 'BAD_INPUT', '草稿数据格式错误。');
    db.prepare(
      `INSERT INTO revision_drafts (document_id,base_version_no,data_json,updated_by,updated_at)
       VALUES (?,?,?,?,datetime('now'))
       ON CONFLICT(document_id) DO UPDATE SET
         base_version_no=excluded.base_version_no,
         data_json=excluded.data_json,
         updated_by=excluded.updated_by,
         updated_at=datetime('now')`
    ).run(req.params.docId, Number.isFinite(baseNo) ? baseNo : doc.current_no, JSON.stringify(data), req.user.id);
    res.json({ ok: true, currentVersionNo: doc.current_no });
  })
);

/**
 * 提交新版本
 * body: { baseVersionNo, note, rows: [{ rowId, num, heading, body, sources:[clauseId...] }] }
 */
router.post(
  '/docs/:docId/commit',
  wrap((req, res) => {
    const doc = getDocOrThrow(req.params.docId);

    // —— 多人并发：版本号乐观锁，过期提交直接拒绝，不静默覆盖 ——
    const baseNo = Math.trunc(Number(req.body.baseVersionNo));
    if (!Number.isFinite(baseNo)) throw new ApiError(400, 'BAD_INPUT', '缺少基准版本号。');
    if (baseNo !== doc.current_no) {
      throw new ApiError(
        409,
        'STALE_VERSION',
        `版本冲突：您基于的是第 ${baseNo} 版，当前最新为第 ${doc.current_no} 版。请取回当前版本后重新处理，系统不会静默覆盖他人修订。`,
        { baseVersionNo: baseNo, currentVersionNo: doc.current_no, current: buildVersionPayload(doc, doc.current_no) }
      );
    }

    const rawRows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rawRows.length) throw new ApiError(400, 'BAD_INPUT', '提交内容不能为空。');

    const nextRows = rawRows.map((r, i) => ({
      id: String(r.rowId || nanoid(10)),
      num: String(r.num || '').trim(),
      heading: String(r.heading || '').trim(),
      body: String(r.body || '').trim(),
      sources: Array.isArray(r.sources) ? [...new Set(r.sources.map(String))] : [],
      ord: i,
    }));
    for (const r of nextRows) r.contentHash = hashOf(r.heading, r.body);
    for (const r of nextRows) {
      if (!/^\d+(?:\.\d+)*$/.test(r.num) && r.num !== '0') {
        throw new ApiError(400, 'BAD_NUMBER', `非法条款编号：${r.num}（应为数字点分式，如 3 或 3.1）。`, { num: r.num });
      }
    }

    const oldVer = db
      .prepare('SELECT * FROM versions WHERE document_id=? AND version_no=?')
      .get(doc.id, doc.current_no);
    const oldClauses = db
      .prepare('SELECT id,num,heading,body,content_hash AS contentHash,ord FROM clauses WHERE version_id=? ORDER BY ord')
      .all(oldVer.id);

    // —— 沿革推断（内含重复编号、空条款、来源校验）——
    const edges = computeLineage(oldClauses, nextRows);

    // —— 引用完整性：新版本所有引用必须能在新版本中找到 ——
    const newNums = new Set(nextRows.map((r) => r.num));
    const missingRefs = new Set();
    for (const r of nextRows) {
      for (const ref of extractReferences(`${r.heading}\n${r.body}`)) {
        if (!newNums.has(ref)) missingRefs.add(ref);
      }
    }
    if (missingRefs.size) {
      throw new ApiError(
        422,
        'BROKEN_REFERENCE',
        `存在引用了不存在的条款：${[...missingRefs].join('、')}。请先修正引用再提交。`,
        { missing: [...missingRefs] }
      );
    }

    const newNo = doc.current_no + 1;
    const newVerId = nanoid(14);
    const note = String(req.body.note || '').slice(0, 500);

    const run = db.transaction(() => {
      // 新版本与条款
      db.prepare('INSERT INTO versions (id,document_id,version_no,note,created_by) VALUES (?,?,?,?,?)').run(
        newVerId, doc.id, newNo, note || '修订提交', req.user.id
      );
      const insClause = db.prepare(
        'INSERT INTO clauses (id,document_id,version_id,ord,num,heading,body,content_hash) VALUES (?,?,?,?,?,?,?,?)'
      );
      const newClauseIdByRow = new Map();
      nextRows.forEach((r) => {
        const cid = nanoid(14);
        newClauseIdByRow.set(r.id, cid);
        insClause.run(cid, doc.id, newVerId, r.ord, r.num, r.heading, r.body, r.contentHash);
      });

      // 物化沿革边
      const insEdge = db.prepare(
        `INSERT INTO clause_lineage
           (id,document_id,old_version_id,new_version_id,old_clause_id,new_clause_id,old_num,new_num,relation)
         VALUES (?,?,?,?,?,?,?,?,?)`
      );
      for (const e of edges) {
        insEdge.run(
          nanoid(14), doc.id, oldVer.id, newVerId,
          e.oldClauseId, e.newClauseId ? newClauseIdByRow.get(e.newClauseId) : null,
          e.oldNum, e.newNum, e.relation
        );
      }

      const edgesByOld = new Map();
      for (const e of edges) {
        if (!e.oldClauseId) continue;
        if (!edgesByOld.has(e.oldClauseId)) edgesByOld.set(e.oldClauseId, []);
        edgesByOld.get(e.oldClauseId).push({
          ...e,
          newClauseId: e.newClauseId ? newClauseIdByRow.get(e.newClauseId) : null,
        });
      }
      const newClauseById = new Map(nextRows.map((r) => [newClauseIdByRow.get(r.id), r]));

      // —— 批注继承与重新定位 ——
      const oldPlaced = db.prepare('SELECT * FROM annotation_placed WHERE version_id=?').all(oldVer.id);
      const insPlaced = db.prepare(
        'INSERT INTO annotation_placed (id,annotation_id,version_id,clause_id,clause_num,status) VALUES (?,?,?,?,?,?)'
      );
      const updateAnnotationAnchor = db.prepare(
        'UPDATE annotations SET anchor_num=? WHERE id=?'
      );
      for (const p of oldPlaced) {
        if (p.status === 'deleted_history') {
          // 删除条款的批注：只保留在历史版本，不向前传播
          continue;
        }
        let outgoing = p.clause_id ? (edgesByOld.get(p.clause_id) || []) : [];
        // 待重新定位的批注没有 clause_id：沿记录的旧编号找到旧条款的沿革边继续尝试
        if (p.status === 'pending' && !outgoing.length) {
          const oldRow = oldClauses.find((c) => c.num === p.clause_num);
          if (oldRow) outgoing = edgesByOld.get(oldRow.id) || [];
        }
        const ann = db.prepare('SELECT anchor_quote AS q FROM annotations WHERE id=?').get(p.annotation_id);
        const loc = locateAnnotation({ quote: ann ? ann.q : '', outgoing, newClauseById });
        let clauseNum = p.clause_num;
        let clauseId = loc.clauseId;
        let status = loc.status;
        // 原本待定位的批注：后继条款仍存在但片段匹配不上时继续待定位；
        // 旧条款确已删除（无任何活的后继）则归入历史版本
        if (p.status === 'pending' && status === 'deleted_history') {
          const hasLiveSuccessor = outgoing.some((e) => e.newClauseId);
          if (hasLiveSuccessor) status = 'pending';
        }
        if (clauseId) clauseNum = newClauseById.get(clauseId).num;
        insPlaced.run(nanoid(14), p.annotation_id, newVerId, clauseId, clauseNum, status);
        if (status === 'anchored' && clauseId) {
          updateAnnotationAnchor.run(newClauseById.get(clauseId).num, p.annotation_id);
        }
      }

      // —— 签核仅继承到内容未变的一对一后继 ——
      const inherits = signoffInheritable(edgesByOld);
      const oldSignoffs = db.prepare('SELECT * FROM signoffs WHERE version_id=?').all(oldVer.id);
      const signByClause = new Map();
      for (const s of oldSignoffs) {
        if (!signByClause.has(s.clause_id)) signByClause.set(s.clause_id, []);
        signByClause.get(s.clause_id).push(s);
      }
      const insSign = db.prepare(
        'INSERT OR IGNORE INTO signoffs (id,document_id,version_id,clause_id,clause_num,user_id) VALUES (?,?,?,?,?,?)'
      );
      for (const { oldClauseId, newClauseId, newNum } of inherits) {
        for (const s of signByClause.get(oldClauseId) || []) {
          insSign.run(nanoid(14), doc.id, newVerId, newClauseId, newNum, s.user_id);
        }
      }

      db.prepare('UPDATE documents SET current_no=? WHERE id=?').run(newNo, doc.id);
      db.prepare('DELETE FROM revision_drafts WHERE document_id=?').run(doc.id);
    });
    run();

    const fresh = db.prepare('SELECT * FROM documents WHERE id=?').get(doc.id);
    res.status(201).json(buildVersionPayload(fresh, newNo));
  })
);

export default router;
