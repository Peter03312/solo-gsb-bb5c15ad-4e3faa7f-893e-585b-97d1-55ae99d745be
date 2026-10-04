import crypto from 'node:crypto';

export function sha256(text) {
  return crypto.createHash('sha256').update(text.replace(/\s+$/, ''), 'utf8').digest('hex');
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
