# RegCollate · 多人技术规程校勘平台

面向**多人协作校勘带编号技术规程**的 Web 应用：导入带唯一条款编号的 Markdown 版本，支持条款**重排、拆分、合并**，自动记录相邻版本之间的**编号沿革**；批注锚定条款与原文片段，签核只继承给内容未变的后继条款；多人并发修订用版本号做乐观锁，过期提交一律拒绝并返回当前版本。

- **技术栈**：Node.js（Express）· React 18（Vite）· SQLite（better-sqlite3）
- **部署**：Dockerfile（多阶段构建）+ Docker Compose 一键启动
- **数据库**：单个 SQLite 文件，容器内位于 `/app/data/app.db`，使用命名卷持久化

---

## 一、快速启动（推荐，Docker Compose）

前置要求：已安装 Docker 20.10+ 与 Docker Compose v2（`docker compose version` 可执行）。

```bash
# 1. 进入项目目录
cd regcollate

# 2. （可选）准备配置：复制环境变量样板
cp .env.example .env
#    编辑 .env，至少把 JWT_SECRET 改成强随机值；
#    HOST_PORT 可修改宿主机暴露端口（默认 3000）。

# 3. 一键构建并后台启动
docker compose up -d --build

# 4. 查看状态 / 日志
docker compose ps
docker compose logs -f
```

启动后访问：

| 用途 | 地址 |
| --- | --- |
| **应用首页 / 登录** | **http://localhost:3000** |
| 健康检查 | http://localhost:3000/api/health |
| 前端静态资源 | http://localhost:3000/assets/… |

首次启动自动初始化演示数据：

- 账号 **`zhangsan`** / **`lisi`**，密码均为 **`demo1234`**
- 一份《示例技术规程》及示例批注、签核（可在界面「注册」新建账号协作）

停止与清理：

```bash
docker compose down          # 停止并删除容器（保留数据卷）
docker compose down -v       # 同时删除数据库卷（清空全部数据）
```

### 不使用 Compose，直接 Docker 运行

```bash
docker build -t regcollate:latest .
docker run -d --name regcollate \
  -p 3000:3000 \
  -v regcollate-data:/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  regcollate:latest
# 访问 http://localhost:3000
```

---

## 二、本地开发启动（无 Docker）

要求 Node.js 20+。

```bash
# 安装根 workspace 全部依赖（server + client）
npm install

# 方式 A：生产模式（先构建前端，再由 Express 托管）
npm run build
PORT=3000 DB_PATH=./data/app.db npm start
# → http://localhost:3000

# 方式 B：前后端分离热更新
npm run dev:server   # 终端 1：API http://localhost:3000
npm run dev:client   # 终端 2：Vite http://localhost:5173 （/api 自动代理到 3000）
```

后端冒烟测试（覆盖编号沿革、批注定位、签核继承、冲突拒绝等全部规则）：

```bash
PORT=3111 DB_PATH=/tmp/rc-smoke/app.db node server/src/index.js &   # 先起服务
BASE=http://localhost:3111 node scripts/smoke.mjs                  # 27 项断言
```

---

## 三、配置项

通过环境变量配置（Compose 可在项目根目录的 `.env` 中设置）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 容器内服务监听端口（一般无需修改；改对外端口用 Compose 的 `HOST_PORT`） |
| `HOST_PORT` | `3000` | Compose 映射到宿主机的端口 |
| `JWT_SECRET` | `please-change-this-secret` | 登录令牌签名密钥，**生产必须修改**（建议 `openssl rand -hex 32`） |
| `DB_PATH` | `/app/data/app.db` | SQLite 数据库文件路径；数据卷挂载点，勿指向临时目录 |
| `SEED_ON_START` | `true` | 首次启动（用户表为空时）是否初始化演示账号与示例规程；设为 `false` 可关闭 |

---

## 四、使用指南

### 1. 导入 Markdown

在「规程列表」点击 **＋ 导入 Markdown 版本**，粘贴或选择 `.md` 文件。条款用 Markdown 标题表示：

```markdown
# 规程标题（可选，首个一级标题作为默认标题）

## 1 范围
正文……引用其他条款写作 §2 或「第2条」。

## 1.1 子条款
编号支持数字点分式，如 3、3.1、3.1.2，也兼容「第3条」「３．１」全角写法。

## 2 术语
……
```

**导入与每次提交都会强制校验，违例直接拒绝并说明原因：**

- **重复编号**（`DUP_NUMBER`）：同一版本中两个条款编号相同 → 拒绝，指出编号。
- **引用不存在的条款**（`BROKEN_REFERENCE`）：正文里的 `§x.y` / 「第 x.y 条」在当前版本找不到 → 拒绝，列出全部失效编号。
- **空条款、非法编号**：编号必须为数字点分式，正文不得为空。

### 2. 修订：重排 / 拆分 / 合并

打开规程 → 「修订」页，基于当前版本编辑：

- **重排 / 改号**：用行首 `↑` `↓` 调整顺序，或直接改编号；**内容逐字未变**时沿革记为「改号·内容未变」。
- **拆分**：点某行「拆分」，新行自动继承同一来源条款；编辑两行内容后提交，沿革记为 `split_from`。
- **合并**：点「合并模式」勾选两行及以上 → 「合并选中项」，来源条款取并集，沿革记为 `merged_into`。
- **删除**：删除某行即表示该条款在新版本消失（沿革记为「删除」）。**新增**条款无来源（可手动「＋ 指定来源」纠正自动判断）。
- 编辑器每行右侧实时预览该行将被记录的沿革关系；可随时「保存草稿」。

提交时服务端基于显式来源 + 内容哈希推断相邻版本的全部沿革边，在「编号沿革」页可逐版查看。

### 3. 批注锚定与重新定位规则

- 选中条款正文片段（须在条款内**唯一出现**）即可批注；片段不唯一或与原文不一致会被拒绝。
- 相邻版本提交时：
  - **仅换序 / 改号且内容未变** → 批注**直接沿用定位**（`anchored`），无需人工干预；
  - **内容改变、拆分或合并** → 用批注原文片段在后继条款中自动匹配，**恰好唯一命中**才沿用；
  - 片段**无法唯一匹配或消失** → 批注进入「🧭 待重新定位」列表，需人工选择目标条款并确认原文片段；
  - 条款被**删除** → 批注不向新版传播，**保留在历史版本**中可查（状态 `deleted_history`）。

### 4. 签核继承

- 签核绑定「版本 + 条款 + 用户」。提交新版本时，签核**仅自动继承到内容逐字未变的一对一后继条款**（沿用 / 改号）。
- 内容修改、拆分、合并、删除、新增的条款一律需要**重新签核**，界面条款卡片与沿革页均展示签核状态。

### 5. 多人并发与冲突检测（乐观锁）

- 所有修订都基于某个版本号 `baseVersionNo`。提交时若该号不等于文档当前最新版本号（已有他人提交了新版本），返回 **409 `STALE_VERSION`**，响应体 `error.details.current` 中带**当前完整版本**数据，界面弹出冲突对话框，提示「取回当前版本重新处理」。
- **绝不静默覆盖**：冲突时数据库不写入任何内容，旧草稿可保留并对照新版本重做。

### 6. 版本浏览与沿革

- 右上角版本下拉框可查看任意历史版本；被删条款的批注只在对应历史版本中出现。
- 「编号沿革」页按相邻版本列出全部 `沿用 / 改号 / 内容修改 / 拆分 / 合并 / 删除 / 新增` 关系及对批注、签核的影响。

---

## 五、HTTP API 摘要

所有 `/api/*`（除登录注册）均需 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` · `/api/auth/login` | 注册 / 登录，返回 JWT |
| GET | `/api/docs` | 规程列表 |
| POST | `/api/docs` | 导入 Markdown 创建 v0（校验重复编号/失效引用） |
| GET | `/api/docs/:id` | 当前版本详情（条款、沿革、批注定位、签核） |
| GET | `/api/docs/:id/versions/:no` | 指定历史版本详情 |
| GET | `/api/docs/:id/history` | 版本列表与全部编号沿革 |
| GET/PUT | `/api/revisions/drafts/:docId` | 读取 / 保存修订草稿 |
| POST | `/api/revisions/docs/:id/commit` | 提交新版本（乐观锁；409 返回当前版本） |
| POST | `/api/annotations/docs/:id` | 锚定唯一片段添加批注 |
| POST | `/api/annotations/:id/relocate` | 待定位批注手动重新锚定 |
| POST | `/api/annotations/:id/resolve` | 标记批注解决/恢复 |
| POST/DELETE | `/api/signoffs/docs/:id/clauses/:clauseId` | 签核 / 撤回签核 |

错误响应统一为 `{ "error": { "code", "message", "details" } }`，关键拒绝码：
`DUP_NUMBER`、`EMPTY_CLAUSE`、`BAD_NUMBER`、`BROKEN_REFERENCE`、`STALE_VERSION`、`QUOTE_NOT_FOUND`、`QUOTE_NOT_UNIQUE`、`BAD_SOURCE`。

---

## 六、目录结构

```
regcollate/
├── Dockerfile                 # 多阶段构建（编译 better-sqlite3 + 构建 React）
├── docker-compose.yml         # 一键启动（端口 3000，命名卷持久化）
├── .env.example               # 环境变量样板
├── package.json               # npm workspaces（server + client）
├── examples/
│   └── sample-regulation.md   # 可直接导入的示例规程
├── scripts/
│   └── smoke.mjs              # 后端端到端规则冒烟测试（27 项）
├── server/
│   └── src/
│       ├── index.js           # Express 入口（含静态托管/SPA 回退）
│       ├── db.js              # SQLite 表结构
│       ├── markdown.js        # Markdown 条款解析 + 引用提取
│       ├── lineage.js         # 沿革推断 + 批注定位 + 签核继承规则
│       ├── docService.js      # 版本数据组装
│       ├── routes/            # auth / docs / revisions / annotations / signoffs
│       └── seed.js            # 演示数据
└── client/
    └── src/
        ├── App.jsx
        └── components/        # Login / DocList / DocView / Editor / History
```

## 七、数据模型要点

- `clauses`：条款按版本快照存储（含内容哈希 `content_hash`），历史版本不可变。
- `clause_lineage`：相邻版本间的沿革边（old/new 条款 + 关系类型）。
- `annotations` + `annotation_placed`：批注本体与「在每个版本的定位状态」（`anchored` / `pending` / `deleted_history`）分离。
- `signoffs`：按版本+条款+用户记录，提交新版本时仅向内容未变的一对一后继复制。
- `revision_drafts`：修订草稿（不产生版本），提交成功后自动清除。
