import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { ApiError, wrap } from '../util.js';
import { signToken, authRequired } from '../auth.js';

const router = Router();

router.post('/register', wrap((req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || username).trim() || username;
  if (!/^[A-Za-z0-9_\-一-鿿]{2,32}$/.test(username)) {
    throw new ApiError(400, 'BAD_INPUT', '用户名需为 2-32 位字母、数字、下划线、连字符或中文。');
  }
  if (password.length < 6) throw new ApiError(400, 'BAD_INPUT', '密码至少 6 位。');
  const exists = db.prepare('SELECT 1 FROM users WHERE username=?').get(username);
  if (exists) throw new ApiError(409, 'USER_EXISTS', '用户名已被占用。');
  const id = nanoid(12);
  db.prepare(
    'INSERT INTO users (id, username, display_name, password_hash) VALUES (?,?,?,?)'
  ).run(id, username, displayName, bcrypt.hashSync(password, 10));
  const user = { id, username, displayName };
  res.status(201).json({ token: signToken(user), user });
}));

router.post('/login', wrap((req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    throw new ApiError(401, 'BAD_CREDENTIALS', '用户名或密码错误。');
  }
  res.json({
    token: signToken(row),
    user: { id: row.id, username: row.username, displayName: row.display_name },
  });
}));

router.get('/me', authRequired, (req, res) => {
  const row = db.prepare('SELECT id, username, display_name AS displayName FROM users WHERE id=?').get(req.user.id);
  res.json({ user: row });
});

export default router;
