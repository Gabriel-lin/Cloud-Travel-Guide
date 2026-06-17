# Cloud Travel Guide — Backend

FastAPI + PostgreSQL API，使用 [uv](https://docs.astral.sh/uv/) 管理依赖与工具链。

## 环境要求

- Python **3.12**（见 `.python-version`）
- [uv](https://docs.astral.sh/uv/getting-started/installation/) ≥ 0.8

## 安装

```bash
cd backend
uv sync          # 安装运行时依赖 + dev 工具链
```

仅生产依赖（CI / Docker 构建）：

```bash
uv sync --frozen --no-dev
```

## 本地开发启动

推荐在仓库根目录操作。后端默认监听 `http://127.0.0.1:8000`，前端默认 `http://127.0.0.1:3000`。

### 方式一：本机运行 API + Docker 只跑数据库（推荐）

适合日常改代码、断点调试。

**1. 安装依赖**

```bash
cd backend
uv sync
```

**2. 配置环境变量**

```bash
cd backend
cp .env.example .env
```

本地直连 Docker 中的 Postgres 时，`DATABASE_URL` 应使用 `localhost`（见 `.env.example`）：

```env
DATABASE_URL=postgresql://user:password@localhost:5432/cloud_travel_guide
SECRET_KEY=请替换为至少 32 字节的随机字符串
```

**3. 启动 PostgreSQL**

在仓库根目录执行：

```bash
docker compose -f docker-compose.dev.yml up postgres -d
```

等待健康检查通过（`docker compose -f docker-compose.dev.yml ps` 中 `postgres` 为 `healthy`）。

**4. 执行数据库迁移并启动 API**

```bash
cd backend
make dev
```

Windows PowerShell 无 `make` 时：

```powershell
cd backend
uv run alembic upgrade head
uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**5. 启动前端（另一个终端）**

```bash
cd frontend
npm install
npm run dev
```

确保前端指向本地 API。可在 `frontend/.env.local` 中设置：

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

**6. 验证**

| 检查项 | 地址 / 命令 |
|--------|-------------|
| 健康检查 | http://127.0.0.1:8000/api/v1/health |
| OpenAPI 文档 | http://127.0.0.1:8000/docs |
| 登录页 | http://127.0.0.1:3000/login |

快速冒烟（注册 + 登录）：

```bash
# 注册
curl -X POST "http://127.0.0.1:8000/api/v1/auth/register?username=demo&password=secret123"

# 登录（获取 access_token）
curl -X POST "http://127.0.0.1:8000/api/v1/auth/token" \
  -d "username=demo&password=secret123" \
  -H "Content-Type: application/x-www-form-urlencoded"
```

### 方式二：Docker 一键启动后端

API 与数据库均在容器中运行，代码目录挂载支持热重载。

在仓库根目录：

```bash
docker compose -f docker-compose.dev.yml up backend
```

容器启动时会自动执行 `alembic upgrade head`，然后运行 uvicorn。前端仍需在本机单独启动（见方式一第 5 步）。

### OAuth 本地配置（可选）

使用 GitHub / Google 登录时，在 `backend/.env` 填写对应 Client ID / Secret，并在 OAuth 应用后台注册回调地址：

| 提供商 | 回调 URL |
|--------|----------|
| GitHub | `http://127.0.0.1:8000/api/v1/auth/oauth/github/callback` |
| Google | `http://127.0.0.1:8000/api/v1/auth/oauth/google/callback` |

`OAUTH_BACKEND_CALLBACK_BASE` 需与 API 对外地址一致（本地一般为 `http://127.0.0.1:8000`）。

### 常见问题

**数据库连接失败**

- 确认 Postgres 已启动：`docker compose -f docker-compose.dev.yml ps`
- 本机跑 API 时 `DATABASE_URL` 主机名用 `localhost`，不要用 `postgres`
- Docker 跑 API 时由 compose 注入 `DATABASE_URL=...@postgres:5432/...`，无需改 `.env` 中的主机名

**表结构过旧或迁移冲突**

若曾用旧版 `init.sql` 初始化过数据库，建议清空数据卷后重来：

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up postgres -d
cd backend && uv run alembic upgrade head
```

**端口占用**

- API：`8000`
- Postgres：`5432`
- 前端：`3000`

## 常用命令

使用 `make`（Git Bash / WSL）或下方 `uv run` 等价命令：

| Make | 说明 |
|------|------|
| `make dev` | 迁移数据库 + 启动开发服务器（`127.0.0.1:8000`，热重载） |
| `make serve` | 迁移数据库 + 生产式启动（`0.0.0.0:8000`） |
| `make migrate` | 仅执行 `alembic upgrade head` |
| `make lint` | Ruff 检查 |
| `make fmt` | Ruff 格式化 |
| `make typecheck` | mypy |
| `make test` | pytest + coverage |
| `make check` | 依次执行 lint、typecheck、test |
| `make sync` | `uv sync` 安装依赖 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `postgresql://user:password@postgres:5432/cloud_travel_guide` | PostgreSQL 连接串 |
| `SECRET_KEY` | *(开发默认，生产必改)* | JWT 签名密钥 |
| `CORS_ORIGINS` | `http://127.0.0.1:3000,http://localhost:3000` | 允许的前端源 |
| `OAUTH_REDIRECT_ORIGINS` | `http://127.0.0.1:3000,http://localhost:3000` | OAuth 登录完成后允许携带 token 回跳的前端源 |
| `OAUTH_BACKEND_CALLBACK_BASE` | `http://127.0.0.1:8000` | OAuth 后端回调根地址 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | — | GitHub OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Google OAuth |

本地开发可复制 `.env.example` 为 `.env`（勿提交密钥）。

## 目录结构

采用分层架构，职责清晰、便于测试与扩展：

```
backend/
├── alembic/                 # 数据库迁移（Alembic）
├── app/
│   ├── main.py              # 应用工厂：中间件、路由注册、生命周期
│   ├── api/                 # HTTP 层（薄路由，不含业务逻辑）
│   │   ├── deps.py          # FastAPI 依赖注入
│   │   └── v1/
│   │       ├── auth.py      # /api/v1/auth/*
│   │       └── system.py    # /api/v1/health
│   ├── core/                # 横切关注点
│   │   ├── config.py        # 环境配置（pydantic-settings）
│   │   ├── database.py      # SQLAlchemy engine / session
│   │   ├── security.py      # JWT、密码哈希
│   │   ├── exceptions.py    # 领域异常
│   │   ├── handlers.py      # 全局异常 → HTTP 响应
│   │   └── constants.py     # OAuth URL、枚举常量
│   ├── models/              # ORM 实体（一表一文件）
│   ├── repositories/        # 数据访问层（CRUD / 查询）
│   ├── schemas/             # Pydantic 请求/响应 DTO
│   └── services/            # 业务逻辑层（AuthService、OAuthService）
├── main.py                  # uvicorn 入口
├── tests/
└── pyproject.toml
```

**分层约定**

| 层 | 职责 | 禁止 |
|----|------|------|
| `api/` | 参数校验、依赖注入、调用 service | 直接写 SQL / 业务判断 |
| `services/` | 业务规则、事务编排 | 依赖 FastAPI 类型 |
| `repositories/` | 数据库读写 | 业务逻辑 |
| `models/` | 表结构定义 | HTTP / 校验逻辑 |
| `schemas/` | API 契约（入参/出参） | 数据库操作 |


## 数据库迁移

```bash
cd backend
uv run alembic upgrade head    # 或 make migrate
```

Docker 开发容器启动时会自动执行 `alembic upgrade head`。

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 健康检查 |
| POST | `/api/v1/auth/register` | 注册（query: username, password） |
| POST | `/api/v1/auth/token` | 登录，返回 JWT |
| POST | `/api/v1/auth/logout` | 注销（Bearer token） |
| GET | `/api/v1/auth/me` | 当前用户 |
| GET | `/api/v1/auth/oauth/{github\|google}` | OAuth 授权跳转 |
| GET | `/api/v1/auth/oauth/{provider}/callback` | OAuth 回调 → 重定向前端 |
| POST | `/api/v1/auth/oauth/exchange` | 授权码换 token |

## Git 钩子

与 frontend 共用 [Husky](https://typicode.github.io/husky/)（`frontend/.husky`）。在 `frontend` 执行 `npm install` 后即可生效。

| 钩子 | 何时运行 | 检查内容 |
|------|----------|----------|
| `pre-commit` | 暂存了 `backend/` 下文件 | `pre-commit run`：Ruff check/format、mypy、pytest |
| `commit-msg` | 每次提交 | commitlint（`[type]`、`[type][scope]` 或 `[type](scope)` 格式） |

手动跑与钩子相同的检查：

```bash
# 在仓库根目录
uv run --directory backend pre-commit run --config backend/.pre-commit-config.yaml
```

跳过钩子：`git commit --no-verify`。

## Docker 参考

完整 compose 定义见仓库根目录 `docker-compose.dev.yml`。仅启动数据库：

```bash
docker compose -f docker-compose.dev.yml up postgres -d
```

生产镜像构建见 `Dockerfile.prod`（`uv sync --frozen --no-dev`）。
