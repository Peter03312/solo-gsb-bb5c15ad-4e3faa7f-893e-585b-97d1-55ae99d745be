# 技术规程多人校勘平台

面向多人协作校勘**带唯一条款编号的技术规程（Markdown）**的 Web 应用。
支持条款重排、拆分、合并与编号沿革追踪；批注锚定条款与原文片段并在版本演进时自动沿用或要求重新定位；
签核仅向内容未变的后继条款继承；多人同时修订采用乐观并发（版本号）检测冲突，绝不静默覆盖。

技术栈：**Node.js 20 + Express + better-sqlite3（SQLite）+ React 18（Vite）**，Docker 一键启动。

---

## 一、快速开始（Docker Compose）

前置：已安装 Docker 与 Docker Compose 插件（`docker compose version` 可用）。

```bash
# 1.（可选）复制并修改端口、初始管理员
cp .env.example .env

# 2. 构建并后台启动
docker compose up -d --build

# 3. 查看状态与日志
docker compose ps
docker compose logs -f
```

启动后访问：

> **http://localhost:4000**

默认管理员（仅数据卷**首次初始化**时创建）：

| 用户名 | 密码 |
| --- | --- |
| `admin` | `admin123` |

请通过 `.env` 中的 `ADMIN_PASSWORD` 修改默认口令；也可在登录页注册新账号。

停止与清理：

```bash
docker compose down          # 停止（保留数据卷）
docker compose down -v       # 停止并删除数据（慎用）
```

---

## 二、配置项

通过环境变量（`.env` 或 `docker compose` 的 `environment`）配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_PORT` | `4000` | 宿主机映射端口（容器内固定 4000）。改后访问 `http://localhost:<APP_PORT>` |
| `ADMIN_USERNAME` | `admin` | 首次初始化创建的管理员用户名 |
| `ADMIN_PASSWORD` | `admin123` | 首次初始化创建的管理员密码 |
| `DB_PATH` | `/data/collation.db` | SQLite 数据库文件路径（位于持久化数据卷中） |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | 仅本地裸跑 Node 时使用 |

数据保存在 Docker 卷 `collation-data`（挂载到容器 `/data`），重建镜像不丢数据。

---

## 三、使用指南

### 1. 导入规程（v1）

点击左侧「＋ 导入」，填写标题并粘贴 Markdown。约定：

- 每个条款以 ATX 标题开始：`# 3.2.1 接地体`，**标题行首第一个编号词即条款编号**，全文档唯一。
- 正文内引用其他条款使用 `#编号` 或 `〔编号〕`，例如 `参见 #3.2.1`、`按〔A.1〕执行`。
- 围栏代码块（\`\`\`）内的 `#` 不会被当作标题。

**导入会被拒绝并逐条说明原因的情况：**

- 条款编号重复；
- 引用了不存在的条款（错误信息给出缺失编号与出现位置）；
- 首个标题前存在游离正文、或完全没有解析到条款。

示例文件见 [`examples/sample-regulation.md`](examples/sample-regulation.md)。

### 2. 批注（锚定条款 + 原文片段）

- 在当前版本条款卡片上点「批注」，在弹窗中划选条款原文片段（必须在该条款中**唯一出现**）并填写意见。
- 片段不存在 → 拒绝；片段出现多次（无法唯一匹配）→ 拒绝并提示选取更长的片段。
- 提交修订后，批注在相邻版本间的处理规则：

| 修订情形 | 批注处理 |
| --- | --- |
| 仅换序，内容未变 | **沿用定位**（保持 active） |
| 内容修改，但原片段在后继条款中仍唯一出现 | 自动重新锚定（active） |
| 内容改变后片段失配、拆分、合并 | 列为**待重新定位（pending）**，页面顶部集中处理 |
| 条款被删除 | 批注**保留在历史版本**，不再向新版本传播 |

「待重新定位」需人工选择目标条款并给出能唯一匹配的新片段。

### 3. 签核与继承

- 最新版本可对条款「签核 / 撤销我的签核」。
- 修订提交时，签核**只继承到内容指纹完全未变（unchanged）的后继条款**，并标记「（继承）」；
  内容修改、拆分、合并产生的条款一律不继承，需要重新签核。

### 4. 修订、重排、拆分、合并

在最新版本点「基于本版修订」：

- 直接编辑 Markdown 即可完成重排、改写、增删条款；提交时系统计算相邻版本沿革：
  `added / deleted / unchanged / modified / split / merged`。
- **拆分 / 合并**：展开「设置拆并来源映射」，为每个新条款勾选其在基准版本中的来源条款——
  不选＝新增；选 1 条＝修改/沿用；选多条＝**合并**；同一条款被多个新条款选择＝**拆分**。
  未显式设置时默认按相同编号一对一匹配。
- 条款卡片「编号沿革」按钮展示该条款跨版本的编号变化与关系链。

### 5. 多人并发：乐观锁与冲突返回

- 每次修订必须带基准版本号 `baseVersionNo`（界面自动携带当前最新版本）。
- 若提交时基准版本已过期（他人已提交新版本），服务端返回 **HTTP 409 `version_conflict`**，
  并在响应体中附带**当前版本的完整内容**；前端弹出冲突面板，可一键载入服务器当前版本作为新基础重新处理。
- **不会静默覆盖**任何人的修订。

### 6. 历史版本

- 顶部版本条可查看任意历史版本（只读）：当时的条款文本、批注（含被删条款上留存的批注）、签核状态均原样保留。
- 批注与签核只能写在最新版本上。

---

## 四、本地开发（不用 Docker）

```bash
# 后端（需要可编译 better-sqlite3：python3 / make / g++）
cd server
npm install
DB_PATH=./data/dev.db PORT=4000 node src/index.js

# 前端（另开终端，Vite 开发服务器 5173，/api 代理到 4000）
cd client
npm install
npm run dev
```

访问 http://localhost:5173 。

后端纯逻辑自测（解析、引用校验、沿革推导、片段匹配）：

```bash
cd server && node src/selftest.js
```

端到端 API 冒烟测试（先启动服务端）：

```bash
cd server && PORT=4099 DB_PATH=/tmp/smoke.db node src/index.js &
bash scripts/smoke.sh
```

生产模式下，Express 会直接托管 `client/dist`，即容器镜像中的单服务形态。

---

## 五、HTTP API 摘要

除 `/api/health` 外均需 `Authorization: Bearer <token>`（登录获取）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` · `/api/auth/login` | 注册 / 登录（返回 token） |
| GET | `/api/documents` | 文档列表（含最新版本号） |
| POST | `/api/documents` | 导入 v1；失败返回 422 + `errors[]` |
| GET | `/api/documents/:id/versions` · `/versions/latest` · `/versions/:no` | 版本列表 / 版本快照（条款、批注、签核） |
| POST | `/api/documents/:id/revisions` | 提交修订，body：`{baseVersionNo, markdown, message, sourceMap?}`；过期基准返回 **409 + 当前版本** |
| GET | `/api/clauses/:clauseId/history` | 条款编号沿革 |
| POST | `/api/versions/:vid/annotations` | 新增批注 `{clauseId, quote, content}` |
| POST | `/api/annotations/:id/relocate` | 待定位批注重新锚定 `{clauseId, quote}` |
| POST/DELETE | `/api/versions/:vid/clauses/:cid/signoff` | 签核 / 撤销签核 |

典型错误码：`invalid_markdown`（重复编号等）、`invalid_references`（引用不存在的条款）、
`invalid_lineage`（拆并来源非法）、`version_conflict`（过期版本提交，响应含 `currentVersion`）、
`quote_not_found` / `quote_ambiguous`（片段不存在或不唯一）、`historical_version`（对历史版本执行写操作）。

---

## 六、目录结构

```
.
├── Dockerfile                # 多阶段构建：Vite 构建前端 → Node 运行后端并托管静态文件
├── docker-compose.yml        # 一键启动（含数据卷、健康检查）
├── .env.example
├── examples/sample-regulation.md
├── server/                   # Express + better-sqlite3
│   └── src/
│       ├── db.js             # 建表与初始化（含初始管理员）
│       ├── util.js           # Markdown 条款解析 / 引用提取 / 内容指纹 / 片段匹配
│       ├── lineage.js        # 相邻版本沿革推导（added/deleted/unchanged/modified/split/merged）
│       ├── services.js       # 事务：修订提交、批注传播、签核继承、乐观并发
│       ├── routes.js · index.js
│       ├── selftest.js       # 纯逻辑自测
│       └── scripts/smoke.sh  # 端到端 API 冒烟测试
└── client/                   # React + Vite
    └── src/
        ├── api.js            # fetch 封装、版本号冲突错误类型、Markdown 序列化
        └── components/       # 版本视图、批注/沿革/重定位弹窗、修订编辑器、导入弹窗
```

## 七、数据模型要点

- `clauses` 按**版本快照**存储（每版本独立行），逻辑条款的跨版本对应关系由 `clause_lineage`
  的相邻版本有向边表达，天然支持重排、拆分（一对多）、合并（多对一）与删除。
- `annotations`、`signoffs` 同样按版本快照存储：批注用 `thread_id` 串联讨论串、用 `status`
  （active/pending/archived）表达定位状态；签核用 `inherited` 区分直接签核与内容未变自动继承。
- 内容指纹 `content_hash = sha256(num + title + body)`：仅换序时指纹不变 → unchanged。
