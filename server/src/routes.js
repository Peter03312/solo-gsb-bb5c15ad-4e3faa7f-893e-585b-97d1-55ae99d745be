import express from 'express';
import * as svc from './services.js';
import { verifyPassword } from './db.js';

export const router = express.Router();

/* ---------- 鉴权中间件 ---------- */
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = token && svc.getUserByToken(token);
  if (!user) return res.status(401).json({ error: { code: 'unauthorized', message: '请先登录' } });
  req.user = user;
  req.token = token;
  next();
}

const wrap = (fn) => (req, res) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((err) => {
      if (err instanceof svc.ApiError) {
        return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
      }
      console.error(err);
      res.status(500).json({ error: { code: 'internal', message: '服务器内部错误' } });
    });

/* ---------- 认证 ---------- */
router.post('/auth/register', wrap((req, res) => {
  const user = svc.register(req.body || {});
  res.status(201).json(user);
}));

router.post('/auth/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  res.json(svc.login({ username, password }, verifyPassword));
}));

router.post('/auth/logout', auth, wrap((req, res) => {
  res.json({ ok: true });
}));

router.get('/auth/me', auth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, displayName: req.user.display_name } });
});

router.get('/users', auth, wrap((req, res) => {
  res.json({ users: svc.listUsers() });
}));

/* ---------- 文档 ---------- */
router.get('/documents', auth, wrap((req, res) => {
  res.json({ documents: svc.listDocuments() });
}));

router.post('/documents', auth, wrap((req, res) => {
  const { title, markdown } = req.body || {};
  const result = svc.createDocument({ title, markdown, userId: req.user.id });
  res.status(201).json(result);
}));

router.get('/documents/:id/versions', auth, wrap((req, res) => {
  res.json({ versions: svc.listVersions(req.params.id) });
}));

router.get('/documents/:id/versions/latest', auth, wrap((req, res) => {
  const doc = svc.getDocOrThrow(req.params.id);
  const latest = svc.listVersions(doc.id).at(-1);
  res.json(svc.buildVersionPayload(doc.id, latest.version_no));
}));

router.get('/documents/:id/versions/:no', auth, wrap((req, res) => {
  const no = Number(req.params.no);
  if (!Number.isInteger(no)) return res.status(400).json({ error: { code: 'bad_request', message: '版本号必须是整数' } });
  res.json(svc.buildVersionPayload(req.params.id, no));
}));

router.post('/documents/:id/revisions', auth, wrap((req, res) => {
  const { baseVersionNo, markdown, message, sourceMap } = req.body || {};
  const result = svc.createRevision({
    docId: req.params.id,
    baseVersionNo: Number(baseVersionNo),
    markdown, message, sourceMap,
    userId: req.user.id,
  });
  res.status(201).json(result);
}));

/* ---------- 条款沿革 ---------- */
router.get('/clauses/:clauseId/history', auth, wrap((req, res) => {
  res.json(svc.getClauseHistory(req.params.clauseId));
}));

/* ---------- 批注 ---------- */
router.post('/versions/:versionId/annotations', auth, wrap((req, res) => {
  const { clauseId, quote, content } = req.body || {};
  res.status(201).json(svc.createAnnotation({
    versionId: req.params.versionId, clauseId, quote, content, userId: req.user.id,
  }));
}));

router.post('/annotations/:id/relocate', auth, wrap((req, res) => {
  const { clauseId, quote } = req.body || {};
  res.json(svc.relocateAnnotation({
    annotationId: req.params.id, clauseId, quote, userId: req.user.id,
  }));
}));

/* ---------- 签核 ---------- */
router.post('/versions/:versionId/clauses/:clauseId/signoff', auth, wrap((req, res) => {
  res.json(svc.signoff({
    versionId: req.params.versionId, clauseId: req.params.clauseId, userId: req.user.id,
  }));
}));

router.delete('/versions/:versionId/clauses/:clauseId/signoff', auth, wrap((req, res) => {
  res.json(svc.unsignoff({
    versionId: req.params.versionId, clauseId: req.params.clauseId, userId: req.user.id,
  }));
}));
