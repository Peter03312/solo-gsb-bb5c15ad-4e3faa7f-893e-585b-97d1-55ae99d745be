import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { ApiError } from './util.js';
import { seedIfEmpty } from './seed.js';
import authRoutes from './routes/auth.js';
import docsRoutes from './routes/docs.js';
import revisionsRoutes from './routes/revisions.js';
import annotationsRoutes from './routes/annotations.js';
import signoffsRoutes from './routes/signoffs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (config.seedOnStart) seedIfEmpty();

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/revisions', revisionsRoutes);
app.use('/api/annotations', annotationsRoutes);
app.use('/api/signoffs', signoffsRoutes);

// 生产环境：托管 React 构建产物
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// 统一错误响应
app.use((err, _req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误。' } });
});

app.listen(config.port, () => {
  console.log(`RegCollate 服务已启动: http://localhost:${config.port}`);
});
