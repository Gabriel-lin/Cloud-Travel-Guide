# Cloud Travel Guide — 路线图与工程指南

> 文件名 **ROADMAP**：除功能与时间规划外，还承担 **架构、研发流程、运维** 的单一事实来源（SSOT）。  
> 正文结构仍按 **Mission · Architecture · Process**（简称 MAP）组织，避免与「仅列未来功能」的传统 roadmap 混淆。  
> 子系统细节见 [backend/README.md](../backend/README.md)、[frontend/README.md](../frontend/README.md)；专题见 [§6 文档索引](#6-文档索引)。

---

## 1. Mission（使命与范围）

### 1.1 产品愿景

面向个性化旅行的 **桌面优先** 体验：路线探索、AI 行程规划、动态调整，并逐步接入 **3D 地图 / 区域地形** 与多模态交互（文本为主，语音/视频为远期）。

### 1.2 当前版本边界（v0.1.x）

| 已交付 / 进行中 | 规划中 |
|-----------------|--------|
| 用户注册登录（RSA 信封 + JWT + OAuth） | 世界模型 / Forge 深度集成 |
| 行程 CRUD + AI 规划对话（SSE） | 全链路 vLLM 自托管推理 |
| LangGraph 智能体（规划师 / 向导 / 审稿人） | Map Generator Agent |
| 工具链：搜索、地理、预算、文件、MD→PDF | MOE 视觉 / TTS 管线 |
| Electron + Next 桌面壳 | 独立 Web 客户端（OAuth 已预留） |
| 区域程序化地形引擎（川藏南线试点） | RAG + 在线 RL 工作流 |

### 1.3 非目标（现阶段）

- 在沙箱内无限制 `pip install` / 任意 shell（安全与可复现性）
- 多租户 SaaS 计费（架构可扩展，未实现）
- 替代专业 GIS / 导航（探索与展示为主）

---

## 2. Architecture（系统架构）

### 2.1 逻辑视图

```text
┌─────────────────────────────────────────────────────────────────┐
│  Clients                                                         │
│  ┌──────────────────┐     ┌──────────────────┐                │
│  │ Electron Desktop │     │ Browser (dev/未来) │                │
│  │ Next static +    │     │ 同 UI 栈           │                │
│  │ Vite main/preload│     │                    │                │
│  └────────┬─────────┘     └────────┬───────────┘                │
└───────────┼──────────────────────────┼────────────────────────────┘
            │ HTTPS / SSE              │
            ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend API (FastAPI)                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │ api/v1      │→ │ services     │→ │ repositories + models   │ │
│  │ auth, plan  │  │ plan_chat,   │  │ PostgreSQL              │ │
│  │ health      │  │ auth, export │  └─────────────────────────┘ │
│  └─────────────┘  └──────┬───────┘                               │
│                          │                                       │
│  ┌───────────────────────▼───────────────────────────────────┐ │
│  │ agents/runtime (LangGraph ReAct) + llm (LiteLLM 别名路由)    │ │
│  │ prompts / skills / tools (含 travel、search、sandbox 调度)   │ │
│  └───────────────────────┬───────────────────────────────────┘ │
└──────────────────────────┼───────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   PostgreSQL      sandbox-worker      外部 API
   (行程、用户、     (Docker 隔离任务)   LLM / Tavily /
    agent_jobs)                        OAuth / 开放地理数据
```

### 2.2 部署视图（推荐）

```text
                    [ CDN / 静态托管 ]  ← 未来 Web
                              │
[ 用户桌面 ] ──► [ API :8000 ] ──► [ Managed PostgreSQL ]
                    │
                    ├── sandbox-worker ──► docker-proxy ──► ephemeral 沙箱容器
                    │                      (internal network)
                    └── 命名卷 agent_workspace（智能体工作区）
```

Compose 分层：

| 文件 | 角色 |
|------|------|
| `docker-compose.yml` | 基线：Postgres、API、worker、migrate profile、docker-proxy |
| `docker-compose.dev.yml` | 开发：端口、卷挂载、Compose Watch |
| `docker-compose.prod.yml` | 生产：资源限制、强制 env、`stack.py --prod` 校验 |

统一入口：`python scripts/stack.py up|down|migrate|logs`（见根目录 `.env.example`）。

### 2.3 前端分层

| 层 | 路径 / 技术 | 职责 |
|----|-------------|------|
| 壳层 | `frontend/electron/` | 窗口、协议、主题、OAuth 深链 |
| 应用 | `frontend/src/app/` | Next.js App Router 页面 |
| 功能域 | `components/plan`, `routes`, `auth`… | UI 与交互 |
| 服务 | `frontend/src/service/` | API 客户端、类型 |
| 状态 | `store/`, hooks | Zustand 等 |
| 3D / 地图 | `lib/region-engine`, `lib/terrain`, Cesium/Three | 探索与路线场景 |

### 2.4 后端分层

| 层 | 职责 | 禁止 |
|----|------|------|
| `api/v1` | HTTP、校验、依赖注入 | 业务规则、裸 SQL |
| `services` | 业务编排、SSE 流 | 依赖 FastAPI 类型 |
| `repositories` | 持久化 | 领域规则 |
| `agents` | 智能体组装、工具、沙箱任务 | 绕过 ToolRegistry 的随意 IO |
| `core` | 配置、安全、DB、异常 | — |

### 2.5 智能体与沙箱

- **组装**：`prompts` + `skills` + `tools` → `runtime.py`（LangGraph）→ SSE 事件（`tool_*`, `job_progress`, `plan_updated`）。
- **平台工具**：确定性能力（读文件、`convert_markdown_to_pdf` 等）在 API 进程内执行。
- **沙箱**：`run_sandbox_job` → `agent_jobs` 表 → `sandbox-worker` → 模板 `default` / `playwright`；生产 Linux 可选 `SANDBOX_RUNTIME=runsc`。
- **LLM**：逻辑别名（如 `gpt-5.5`）经 LiteLLM 映射；开发可 `LLM_ALLOW_MOCK=true`。

### 2.6 安全基线

| 领域 | 做法 |
|------|------|
| 密码 | 客户端 RSA-OAEP + AES-GCM 信封；生产必填 `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM` |
| 会话 | JWT + HttpOnly Cookie（Web）；Electron 见生产 OAuth 文档 |
| OAuth | 回调仅后端；`OAUTH_BACKEND_CALLBACK_BASE` 与提供商配置一致 |
| 沙箱 | 无默认外网、cap_drop、只读根 FS；仅 worker 经 docker-proxy 访问 Docker |
| CORS / Cookie | `CORS_ORIGINS`、`AUTH_COOKIE_SECURE`（HTTPS 生产为 true） |

详见 [password-transport-encryption.md](./password-transport-encryption.md)、[production-deployment-and-multi-client-oauth.md](./production-deployment-and-multi-client-oauth.md)。

---

## 3. Process（研发与运维流程）

### 3.1 仓库布局

```text
Cloud-Travel-Guide/
├── backend/          # FastAPI、Alembic、agents、sandbox、worker
├── frontend/         # Next + Electron + 3D/地图
├── docs/             # 专题与本文档 ROADMAP
├── scripts/          # stack.py 等跨栈脚本
├── docker-compose*.yml
└── README.md         # 项目入口
```

### 3.2 本地开发路径

| 场景 | 做法 |
|------|------|
| 全栈日常 | `stack.py up` 或 Postgres Docker + `backend/make dev` + `frontend/npm run dev` |
| 仅 API 调试 | `uv sync` + `scripts/dev_server.py`（Windows 避免 `uvicorn --reload` + SSE） |
| 仅 UI | `npm run dev:next` 或 `dev:electron` |
| 迁移 | `make migrate` / `stack.py migrate` |

环境变量：根目录 `.env`（Compose）、`backend/.env`（API）、`frontend/.env.local`（`NEXT_PUBLIC_API_BASE_URL`）。

### 3.3 质量门禁

| 范围 | 命令 / 钩子 |
|------|-------------|
| Backend | `make check`（Ruff、mypy、pytest）；Husky 暂存 `backend/` 时 pre-commit |
| Frontend | `npm run lint`、`typecheck`、`test`；暂存 `frontend/` 时 lint-staged |
| 提交信息 | commitlint：`[type]` / `[type][scope]` / `[type](scope)` |

### 3.4 发布检查清单（生产 API）

1. `ENVIRONMENT=production`，强 `SECRET_KEY`，`LLM_ALLOW_MOCK=false`
2. `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM` 全副本一致（Secret Manager）
3. `alembic upgrade head` 作为独立部署步骤
4. CORS、OAuth 回调、桌面 `cloud-travel-guide://` 与文档一致
5. 沙箱镜像已构建；worker 可访问 docker-proxy
6. 数据库备份与连接池（托管 PG）

### 3.5 变更与迁移

- **Schema**：仅 Alembic；勿依赖旧版 `init.sql` 作为主路径
- **智能体工具**：新工具注册 `ToolRegistry` + 测试 `tests/agents/`
- **破坏性 API**：更新 `schemas/` + 前端 `service/` 类型 + 本文 §1.2 版本说明

### 3.6 观测与排障

| 症状 | 优先检查 |
|------|----------|
| SSE 卡住 / 无法 Ctrl+C | 使用 `dev_server.py` 或 `stack.py`，勿 Windows 上 `uvicorn --reload` |
| DB 连接失败 | 本机 API 用 `localhost:15432`；容器内用主机名 `postgres` |
| 沙箱任务失败 | worker 日志、`agent_jobs` 状态、镜像是否预拉 |
| LLM 无响应 | 密钥与别名映射、`LLM_ALLOW_MOCK` |
| OAuth 503 | 对应 Provider Client ID/Secret |

---

## 4. 能力地图（Capability Map）

```text
身份与账户 ── auth, OAuth, password cipher
行程数据   ── plans CRUD, travel_plans ORM
对话规划   ── plan/chat SSE, plan_chat_service, plan/threads 云端同步, agents
文档产出   ── markdown_render, document_export, PDF 工具
地理与旅行 ── geocode, budget, pace, itinerary_validate, web_search
探索体验   ── routes UI, region-engine (DEM/OSM), Cesium/Three
桌面交付   ── Electron build, electron-builder → dist/
```

### 4.1 API 面（v1 摘要）

| 域 | 前缀 | 说明 |
|----|------|------|
| 系统 | `/api/v1/health` | 健康检查 |
| 认证 | `/api/v1/auth/*` | 注册登录、OAuth、me |
| 规划 | `/api/v1/plan/*` | agents 目录、chat SSE、**threads 对话同步** |
| 行程 | `/api/v1/plans/*` | 行程 CRUD |

完整表见 [backend/README.md#api](../backend/README.md)。

### 4.2 路线图对照（原 README 愿景）

| 主题 | 状态 | 落点 |
|------|------|------|
| 文本交互 + i18n | 已具备 | `frontend/src/i18n`, plan UI |
| LiteLLM 多模型 | 已具备 | `backend/app/llm` |
| 智能体工作流 | 二期进行中 | `backend/app/agents` |
| 地图交互助手 | 部分 | `region-engine` 计划见 [regional-terrain-engine-plan.md](./regional-terrain-engine-plan.md) |
| Forge + vLLM 自托管 | 规划 | 未接入本仓库运行时 |
| Map Generator Agent | 规划 | — |

---

## 5. 技术栈总表

| 层级 | 选型 |
|------|------|
| 前端 UI | React 19、Next.js、Tailwind v4、shadcn、Zustand |
| 桌面 | Electron、Vite（main/preload）、electron-builder |
| 3D | Three.js / WebGPU、Cesium、region-engine |
| 后端 | Python 3.12、FastAPI、SQLAlchemy、Alembic、uv |
| AI | LangChain / LangGraph、LiteLLM |
| 数据 | PostgreSQL 15 |
| 运行时 | Docker Compose、sandbox-worker、gVisor（可选） |
| CI / 钩子 | Husky、commitlint、pre-commit（backend） |

---

## 6. 文档索引

| 文档 | 用途 |
|------|------|
| [README.md](../README.md) | 项目入口与快速开始 |
| [ROADMAP.md](./ROADMAP.md) | 本文：路线图 + 架构 + 流程（SSOT） |
| [backend/README.md](../backend/README.md) | API 开发、命令、环境变量 |
| [frontend/README.md](../frontend/README.md) | 桌面前端开发、构建 |
| [password-transport-encryption.md](./password-transport-encryption.md) | 登录密码协议 |
| [production-deployment-and-multi-client-oauth.md](./production-deployment-and-multi-client-oauth.md) | 生产部署与多客户端 OAuth |
| [regional-terrain-engine-plan.md](./regional-terrain-engine-plan.md) | 区域 3D 地形实施计划 |

---

## 7. 维护约定

- **需求新增**：先在 §1 / §4 更新范围与能力地图，再拆 issue / PR。
- **架构变更**：更新 §2 并同步子 README 的「架构」小节。
- **版本发布**：`pyproject.toml`、`package.json` 与 §1.2「当前版本边界」保持一致说明。
- **文档语言**：本文与根 README 中英混用处以保持与代码/域名为准；子 README 以中文为主。
