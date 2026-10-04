import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { ApiError } from './util.js';

export function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: '7d',
  });
}

export function authRequired(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, 'UNAUTHORIZED', '请先登录。'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.uid, username: payload.username };
    next();
  } catch {
    next(new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录。'));
  }
}
