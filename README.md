# Cloud Travel Guide

个性化旅行桌面应用：**AI 行程规划**、路线探索与 **3D 区域场景**，统一由 FastAPI 后端与 PostgreSQL 支撑。

| 子系统 | 说明 |
|--------|------|
| [frontend/](frontend/) | Next.js + Electron 桌面壳、规划对话 UI、地图/地形 |
| [backend/](backend/) | REST/SSE API、LangGraph 智能体、沙箱任务 worker |
| [docs/ROADMAP.md](docs/ROADMAP.md) | **路线图与工程指南**（愿景 · 架构 · 流程 — 研发维护 SSOT） |

---

## 顶层架构

```text
Electron / Browser (Next.js)
        │  REST + SSE (/api/v1/plan/chat)
        ▼
FastAPI ──► PostgreSQL
   │
   ├── agents (LangGraph + LiteLLM)
   └── sandbox-worker ──► Docker 隔离作业 (MD/图表/PDF 等)
```

- **客户端**：当前以 **Electron 桌面** 为主；OAuth 与 API 设计支持未来 Web（见 [docs/production-deployment-and-multi-client-oauth.md](docs/production-deployment-and-multi-client-oauth.md)）。
- **智能体**：行程规划师 / 本地向导 / 审稿人 — 提示词 + 技能 + 工具目录（详见 [docs/ROADMAP.md §2.5](docs/ROADMAP.md)）。
- **3D**：Cesium / Three 与自研 `region-engine`（川藏南线等试点，见 [docs/regional-terrain-engine-plan.md](docs/regional-terrain-engine-plan.md)）。

完整逻辑视图、能力地图、发布清单与文档索引见 **[docs/ROADMAP.md](docs/ROADMAP.md)**。

---

## 快速开始

### 环境

| 组件 | 要求 |
|------|------|
| Backend | Python 3.12、[uv](https://docs.astral.sh/uv/) |
| Frontend | Node 22.x（见 `frontend/.nvmrc`） |
| 基础设施 | Docker（Postgres + 可选全栈 Compose） |

### 推荐：Compose 开发栈

仓库根目录：

```bash
cp .env.example .env
cp backend/.env.example backend/.env   # 按需改 SECRET_KEY、LLM 密钥等

python scripts/stack.py up             # 迁移 + API + worker + Postgres
```

另开终端启动前端：

```bash
cd frontend && npm install && npm run dev
```

| 服务 | 地址 |
|------|------|
| API / OpenAPI | http://127.0.0.1:8000 · http://127.0.0.1:8000/docs |
| 前端 | http://127.0.0.1:3000 |
| Postgres（开发映射） | `localhost:15432` |

### 本机 API + Docker 仅数据库

见 [backend/README.md — 本地开发](backend/README.md)。

前端 API 地址（可选）：`frontend/.env.local`

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

---

## 生产部署（摘要）

```bash
# 配置 backend/.env：ENVIRONMENT=production、SECRET_KEY、RSA、DATABASE_URL、LLM 密钥等
python scripts/stack.py up --prod -d
```

`--prod` 会对弱密钥、默认数据库密码、mock LLM 等做 fail-fast。迁移、RSA、OAuth 与多客户端细节见 [docs/ROADMAP.md §3.4](docs/ROADMAP.md) 与 [backend/README.md](backend/README.md)。

---

## 文档导航

| 读者 | 阅读顺序 |
|------|----------|
| 产品 / 架构 | [docs/ROADMAP.md](docs/ROADMAP.md) |
| 后端开发 | [backend/README.md](backend/README.md) |
| 前端 / 桌面 | [frontend/README.md](frontend/README.md) |
| 安全与登录 | [docs/password-transport-encryption.md](docs/password-transport-encryption.md) |

---

## 技术栈（概览）

- **前端**：React、Next.js、Tailwind、Electron、Cesium/Three、Zustand  
- **后端**：FastAPI、PostgreSQL、Alembic、LangChain/LangGraph、LiteLLM  
- **运维**：Docker Compose、`scripts/stack.py`、Husky + commitlint  

愿景与远期（Forge、vLLM、Map Agent 等）已收录在 [docs/ROADMAP.md §1 / §4.2](docs/ROADMAP.md)，避免与本 README 重复展开。
