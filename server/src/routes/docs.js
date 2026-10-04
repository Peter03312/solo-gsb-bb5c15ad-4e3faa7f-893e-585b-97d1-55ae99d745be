import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { ApiError, wrap } from '../util.js';
import { authRequired } from '../auth.js';
import { parseMarkdown, extractReferences } from '../markdown.js';
import {
  buildVersionPayload,
  listLineage,
  listVersions,
} from '../docService.js';

const router = Router();
router.use(authRequired);

// 文档列表
router.get('/', (_req, res) => {
  const docs = db
    .prepare(
      `SELECT d.id, d.title, d.current_no AS currentVersionNo, d.created_at AS createdAt,
              u.username, u.display_name AS displayName
         FROM documents d JOIN users u ON u.id=d.created_by
        ORDER BY d.created_at DESC`
    )
    .all()
    .map((d) => ({
      id: d.id,
      title: d.title,
      currentVersionNo: d.currentVersionNo,
      createdAt: d.createdAt,
      creator: { username: d.username, displayName: d.displayName },
    }));
  res.json({ docs });
});

// 导入 Markdown 创建 v0
router.post(
  '/',
  wrap((req, res) => {
    const md = String(req.body.markdown || '');
    if (!md.trim()) throw new ApiError(400, 'BAD_INPUT', '请提供 Markdown 内容。');
    const parsed = parseMarkdown(md);
    const nums = new Set(parsed.clauses.map((c) => c.num));
    const missing = [...new Set(parsed.clauses.flatMap((c) => extractReferences(`${c.heading}\n${c.body}`)))]
      .filter((r) => !nums.has(r));
    if (missing.length) {
      throw new ApiError(422, 'BROKEN_REFERENCE', `存在引用了不存在的条款：${missing.join('、')}`, { missing });
    }

    const docId = nanoid(12);
    const verId = nanoid(14);
    const title = String(req.body.title || '').trim() || parsed.title;
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO documents (id,title,current_no,created_by) VALUES (?,?,0,?)').run(
        docId, title, req.user.id
      );
      db.prepare('INSERT INTO versions (id,document_id,version_no,note,created_by) VALUES (?,?,0,?,?)').run(
        verId, docId, '初始导入', req.user.id
      );
      const ins = db.prepare(
        'INSERT INTO clauses (id,document_id,version_id,ord,num,heading,body,content_hash) VALUES (?,?,?,?,?,?,?,?)'
      );
      parsed.clauses.forEach((c, i) => {
        ins.run(nanoid(14), docId, verId, i, c.num, c.heading, c.body, c.contentHash);
      });
    });
    tx();

    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(docId);
    res.status(201).json(buildVersionPayload(doc, 0));
  })
);

// 当前版本详情
router.get(
  '/:id',
  wrap((req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
    if (!doc) throw new ApiError(404, 'NOT_FOUND', '规程不存在。');
    res.json(buildVersionPayload(doc, doc.current_no));
  })
);

// 指定历史版本
router.get(
  '/:id/versions/:no',
  wrap((req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
    if (!doc) throw new ApiError(404, 'NOT_FOUND', '规程不存在。');
    res.json(buildVersionPayload(doc, Number(req.params.no)));
  })
);

// 版本列表 + 全部沿革
router.get(
  '/:id/history',
  wrap((req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
    if (!doc) throw new ApiError(404, 'NOT_FOUND', '规程不存在。');
    res.json({
      documentId: doc.id,
      title: doc.title,
      currentVersionNo: doc.current_no,
      versions: listVersions(doc.id),
      lineage: listLineage(doc.id),
    });
  })
);

export default router;
