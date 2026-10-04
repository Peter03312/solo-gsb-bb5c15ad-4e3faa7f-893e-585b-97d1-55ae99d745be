# ---- 构建阶段：安装全部依赖（含 better-sqlite3 原生模块编译回退）并构建前端 ----
FROM node:20-bookworm-slim AS builder

# better-sqlite3 在无预编译二进制时需要本地编译
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制依赖清单，充分利用层缓存
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# 使用与 lockfile 一致的安装（workspaces 会提升到根 node_modules）
RUN npm ci

# 复制源码并构建前端
COPY . .
RUN npm run build -w client

# 去除开发依赖（vite 等），保留运行时所需
RUN npm prune --omit=dev

# ---- 运行阶段 ----
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/app.db \
    SEED_ON_START=true

WORKDIR /app

# 复制依赖与构建产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/dist ./client/dist

# 数据目录归非 root 用户 node 所有
RUN mkdir -p /app/data && chown -R node:node /app
USER node

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
