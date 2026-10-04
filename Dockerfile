# syntax=docker/dockerfile:1

# ---------- 前端构建 ----------
FROM node:20-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---------- 后端运行镜像（同容器托管前端静态文件） ----------
FROM node:20-bookworm-slim AS server
WORKDIR /app/server

# better-sqlite3 为原生模块：优先下载预编译二进制，失败时用工具链本地编译。
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
  && apt-get purge -y --auto-remove python3 make g++ 2>/dev/null || true

COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DB_PATH=/data/collation.db

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4000

# 容器启动即自动建库建表并创建初始管理员（仅首次）。
CMD ["node", "src/index.js"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
