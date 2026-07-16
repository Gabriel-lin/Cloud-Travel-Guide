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

本地开发可不配置 `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM`，后端会自动生成临时 RSA 密钥。若需与生产一致或多人共用同一密钥，可执行：

```bash
cd backend
uv run python scripts/generate_password_rsa_key.py
```

将输出的一行粘贴到 `.env` 即可。

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
uv run uvicorn backend.main:app --app-dir .. --reload --host 127.0.0.1 --port 8000
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

快速冒烟（需先 `GET /api/v1/auth/password-key`，由前端或加密客户端完成；详见 [密码传输加密](../docs/password-transport-encryption.md)）：

```bash
curl http://127.0.0.1:8000/api/v1/health
curl http://127.0.0.1:8000/api/v1/auth/password-key
```

登录 / 注册请通过前端 `http://127.0.0.1:3000/login` 或按文档构造 `password_envelope` 调用 `/api/v1/auth/login`、`/api/v1/auth/register`。

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

本地 `.env` 示例：

```env
OAUTH_BACKEND_CALLBACK_BASE=http://127.0.0.1:8000
OAUTH_REDIRECT_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
AUTH_COOKIE_SECURE=false
GITHUB_CLIENT_ID=你的 GitHub OAuth App Client ID
GITHUB_CLIENT_SECRET=你的 GitHub OAuth App Client Secret
GOOGLE_CLIENT_ID=你的 Google OAuth Client ID
GOOGLE_CLIENT_SECRET=你的 Google OAuth Client Secret
```

配置完成后重启 backend。点击 GitHub / Google 登录时，前端会跳转到后端 `/api/v1/auth/oauth/{provider}`，后端生成授权地址并返回 307 跳转到对应平台授权页。平台授权完成后只回调后端 callback，后端换取 token、写入 HttpOnly Cookie，再跳回前端 `/auth/callback` 恢复会话。

退出登录时，后端会清除本应用 Cookie、拉黑本应用 JWT，并尝试调用 GitHub / Google revoke 接口撤销当前用户对本应用的 OAuth 授权。再次点击第三方登录时，授权 URL 会携带账号选择参数，方便用户切换 GitHub / Google 账号后重新授权；但如果浏览器仍保留平台登录态，平台可能不会再次要求输入密码。

若缺少某个平台的 Client ID 或 Secret，该平台会返回 `503 Service Unavailable`。

`OAUTH_BACKEND_CALLBACK_BASE` 需与 API 对外地址一致（本地一般为 `http://127.0.0.1:8000`），并且 GitHub / Google OAuth 后台配置的 callback URL 必须与表格中的后端 callback 完全一致。`OAUTH_REDIRECT_ORIGINS` 是登录完成后允许回跳的前端源。生产环境使用 HTTPS 时设置 `AUTH_COOKIE_SECURE=true`。

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
| `ENVIRONMENT` | `development` | 设为 `production` 时启用生产安全校验 |
| `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM` | — | 密码传输 RSA 私钥（PKCS#8 PEM）；**生产必填** |
| `AUTH_PASSWORD_ENVELOPE_TTL_SECONDS` | `60` | 加密密码信封有效期（秒） |
| `AUTH_COOKIE_SECURE` | `false` | 生产 HTTPS 下设为 `true` |
| `CORS_ORIGINS` | `http://127.0.0.1:3000,http://localhost:3000` | 允许的前端源 |
| `OAUTH_REDIRECT_ORIGINS` | `http://127.0.0.1:3000,http://localhost:3000` | OAuth 登录完成后允许携带 token 回跳的前端源 |
| `OAUTH_BACKEND_CALLBACK_BASE` | `http://127.0.0.1:8000` | OAuth 后端回调根地址 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | — | GitHub OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Google OAuth |

本地开发可复制 `.env.example` 为 `.env`（勿提交密钥）。

## 生产部署

部署 API 服务前，除 `SECRET_KEY`、`DATABASE_URL`、CORS / OAuth 等常规项外，**必须**配置密码传输 RSA 私钥：

| 变量 | 要求 |
|------|------|
| `ENVIRONMENT` | `production` |
| `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM` | 必填；登录/注册依赖 RSA-OAEP + AES-GCM 解密 |
| `AUTH_COOKIE_SECURE` | `true`（HTTPS） |
| `SECRET_KEY` | 非默认值，至少 32 字符 |

### 生成 RSA 私钥

在 `backend/` 目录执行：

```bash
# 输出可直接写入 .env 的一行
uv run python scripts/generate_password_rsa_key.py

# 仅输出转义后的 PEM（适合 CI / GitHub Secrets）
uv run python scripts/generate_password_rsa_key.py --format value

# 输出原始 PEM 文件
uv run python scripts/generate_password_rsa_key.py --format pem > password_rsa.pem
```

写入 `.env` 或容器环境变量时，推荐使用单行转义格式：

```env
AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----"
```

### 部署检查清单

1. 执行数据库迁移：`uv run alembic upgrade head`（含 `password_cipher_nonces` 表）。
2. 为所有 API 实例注入**相同**的 `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM`（多副本须共享同一密钥）。
3. 通过 Secret Manager / GitHub Actions Secrets 注入，勿将私钥提交到仓库。
4. 确认前端仅调用 `/api/v1/auth/login`、`/api/v1/auth/register`（传输 `password_envelope`，无明文密码）。

协议与字段说明见仓库文档：[docs/password-transport-encryption.md](../docs/password-transport-encryption.md)。

### GitHub Actions 示例

将生成的 PEM 存入仓库 Secret `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM`，在部署 job 中注入：

```yaml
env:
  ENVIRONMENT: production
  AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM: ${{ secrets.AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM }}
  AUTH_COOKIE_SECURE: "true"
```

生产环境应使用长期固定的密钥；不要在每次 CI 构建时重新生成，除非有计划地轮换密钥。

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
| GET | `/api/v1/auth/password-key` | 获取密码传输 RSA 公钥 |
| POST | `/api/v1/auth/register` | 注册（JSON：`username` + `password_envelope`） |
| POST | `/api/v1/auth/login` | 登录，返回 JWT（JSON：`username` + `password_envelope`） |
| POST | `/api/v1/auth/logout` | 注销（Bearer token） |
| GET | `/api/v1/auth/me` | 当前用户 |
| GET | `/api/v1/auth/oauth/{github\|google}` | OAuth 授权跳转 |
| GET | `/api/v1/auth/oauth/{provider}/callback` | OAuth 回调 → 重定向前端 |
| POST | `/api/v1/auth/oauth/exchange` | 授权码换 token |
| GET | `/api/v1/plan/agents` | 智能体 + 模型别名目录 |
| POST | `/api/v1/plan/chat` | 规划对话（SSE 流式） |
| GET | `/api/v1/plans` | 行程列表（需登录） |
| POST | `/api/v1/plans` | 创建行程 |
| GET | `/api/v1/plans/{id}` | 行程详情 |
| PUT | `/api/v1/plans/{id}` | 更新行程 |
| DELETE | `/api/v1/plans/{id}` | 删除行程 |

### LLM 多模型（LiteLLM）

生产做法：智能体只引用**逻辑别名**（`gpt-5.5` / `opus-4.8` / `deepseek-v3`），由 `app/llm` 映射到 LiteLLM 路由。

配置方式（二选一或混用），见 `.env.example`：

1. **官方密钥**：`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY`
2. **三方 OpenAI 兼容网关**：`LLM_OPENAI_COMPAT_BASE_URL` + `LLM_OPENAI_COMPAT_API_KEY`

未配置密钥且 `LLM_ALLOW_MOCK=true` 时，对话返回本地 mock 流（便于先联调 UI）。

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
