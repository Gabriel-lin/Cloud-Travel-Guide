# Cloud Travel Guide — Backend

Python **3.12** · **FastAPI** · **PostgreSQL** · **LangGraph 智能体** · 依赖管理 **[uv](https://docs.astral.sh/uv/)**。

系统全貌与发布流程见仓库 **[docs/ROADMAP.md](../docs/ROADMAP.md)**。

---

## 架构

```text
api/v1 (薄路由)
    → services (业务、SSE plan_chat)
        → repositories → models → PostgreSQL
agents/runtime (LangGraph ReAct)
    → llm (LiteLLM 别名) + tools + skills + prompts
sandbox-worker ← agent_jobs ← run_sandbox_job 工具
```

| 目录 | 职责 |
|------|------|
| `app/api/v1/` | HTTP：`auth`、`plan`、`health` |
| `app/services/` | 认证、行程、对话流、文档导出 |
| `app/agents/` | 智能体规格、运行时、工具与沙箱调度 |
| `app/llm/` | 模型别名与 LangChain 适配 |
| `sandbox/`、`sandbox_worker/` | 隔离容器镜像与 worker |
| `alembic/` | 唯一 schema 来源 |

分层约定：`api` 不写 SQL；`services` 不依赖 FastAPI 类型；详见 [ROADMAP §2.4](../docs/ROADMAP.md)。

**智能体（摘要）**：三内置角色由 `prompts` + `skills` + `tool_ids` 组装；通用工具 + 旅行专用工具；联网搜索可插拔（Tavily / DuckDuckGo）。PDF 优先平台工具 `convert_markdown_to_pdf`，勿在沙箱内临时装包。

---

## 环境要求

- Python **3.12**（`.python-version`）
- [uv](https://docs.astral.sh/uv/getting-started/installation/) ≥ 0.8
- Docker（本地 Postgres 或全栈）

```bash
cd backend && uv sync
```

---

## 本地开发

### A. 仓库根 Compose（推荐）

```bash
# 根目录
python scripts/stack.py up          # 前台；加 -d 后台；--watch 同步代码重启
python scripts/stack.py migrate
python scripts/stack.py down
```

- API：http://127.0.0.1:8000  
- 开发 Postgres：`localhost:15432`  
- 前端仍本机：`cd frontend && npm run dev`

### B. 本机只跑 API

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up postgres -d
cd backend && cp .env.example .env   # DATABASE_URL 用 localhost:15432
make dev                           # 或见下 Windows
```

**Windows**：勿用 `uvicorn --reload`（SSE 易卡死）；使用：

```powershell
uv run alembic upgrade head
uv run python scripts/dev_server.py
```

### 验证

| 项 | 地址 |
|----|------|
| Health | http://127.0.0.1:8000/api/v1/health |
| OpenAPI | http://127.0.0.1:8000/docs |

本地 RSA：可不配 `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM`（临时密钥）；生产见下文。

OAuth 回调与 `.env` 示例见 [ROADMAP §2.6](../docs/ROADMAP.md) 与 `.env.example`。

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `make dev` | 迁移 + 开发服（`127.0.0.1:8000`） |
| `make migrate` | `alembic upgrade head` |
| `make check` | Ruff + mypy + pytest |
| `make lint` / `fmt` / `test` | 分项质量 |

无 `make` 时：`uv run alembic …`、`uv run pytest` 等。

---

## 环境变量（核心）

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL |
| `SECRET_KEY` | JWT；生产必改 |
| `ENVIRONMENT` | `production` 启用严格校验 |
| `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM` | 生产必填 |
| `CORS_ORIGINS` / `OAUTH_*` | 前端与 OAuth |
| `OPENAI_*` / `ANTHROPIC_*` / `DEEPSEEK_*` / `LLM_*` | LiteLLM 路由 |
| `LLM_ALLOW_MOCK` | 开发无密钥时可 `true` |
| `AGENT_SEARCH_PROVIDER` | `auto` / `tavily` / `duckduckgo` |
| `SANDBOX_RUNTIME` | 默认 `runc`；Linux 生产可选 `runsc` |

完整列表见 `.env.example`。密码协议：[docs/password-transport-encryption.md](../docs/password-transport-encryption.md)。

生成 RSA：

```bash
uv run python scripts/generate_password_rsa_key.py
```

---

## 部署

### Compose 生产

根目录配置 `backend/.env` 后：

```bash
python scripts/stack.py up --prod -d
```

迁移与 API 解耦：`stack.py migrate` 或 compose `migrate` profile。

### 检查清单

1. `alembic upgrade head`
2. 强 `SECRET_KEY`、`AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM`（多副本同密钥）
3. `AUTH_COOKIE_SECURE=true`（HTTPS）
4. `LLM_ALLOW_MOCK=false`
5. 沙箱镜像已 build；worker 正常 claim `agent_jobs`

镜像：`backend/Dockerfile.prod`（`uv sync --frozen --no-dev`）。多客户端 OAuth：[docs/production-deployment-and-multi-client-oauth.md](../docs/production-deployment-and-multi-client-oauth.md)。

---

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 健康检查 |
| GET/POST | `/api/v1/auth/*` | 密码信封登录注册、OAuth、me |
| GET | `/api/v1/plan/agents` | 智能体与模型目录 |
| POST | `/api/v1/plan/chat` | 规划对话 **SSE**（需登录） |
| CRUD | `/api/v1/plans` | 行程 |

---

## 质量与钩子

与 frontend 共用 Husky（`frontend/.husky`）。暂存 `backend/` 时：`pre-commit`（Ruff、mypy、pytest）。

```bash
uv run --directory backend pre-commit run --config backend/.pre-commit-config.yaml
```

---

## 延伸阅读

- 沙箱模板、工具分层、E2B 备选：[docs/ROADMAP.md §2.5](../docs/ROADMAP.md)（原长文已收敛至 ROADMAP）
- 排障（DB 主机名、卷重置、端口）：[docs/ROADMAP.md §3.6](../docs/ROADMAP.md)
