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

## 常用命令

使用 `make`（Git Bash / WSL）或下方 `uv run` 等价命令：

| Make | `uv run` 等价 | 说明 |
|------|---------------|------|
| `make dev` | `uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000` | 开发服务器 |
| `make serve` | `uv run uvicorn main:app --host 0.0.0.0 --port 8000` | 生产式启动 |
| `make lint` | `uv run ruff check .` | Ruff 检查 |
| `make fmt` | `uv run ruff format .` | Ruff 格式化 |
| `make typecheck` | `uv run mypy .` | mypy |
| `make test` | `uv run pytest` | pytest + coverage |
| `make check` | 依次执行 lint、typecheck、test | 全量检查 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `postgresql://user:password@postgres:5432/cloud_travel_guide` | PostgreSQL 连接串 |

本地开发可复制 `.env.example` 为 `.env`（勿提交密钥）。

## 目录结构

```
backend/
├── main.py           # FastAPI 入口
├── db/               # 数据库连接
├── models/           # Pydantic 模型
├── services/         # 业务逻辑
├── utils/            # 工具（密码哈希等）
├── tests/            # pytest
└── pyproject.toml    # 依赖与工具配置
```

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

## Docker

```bash
# 开发
docker compose -f ../docker-compose.dev.yml up backend

# 生产镜像构建见 Dockerfile.prod（uv sync --frozen --no-dev）
```
