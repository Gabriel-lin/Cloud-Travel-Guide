# Cloud Travel Guide — Frontend

**Next.js** 应用 + **Electron** 桌面壳：规划对话、认证、路线探索与 3D/地图场景。

产品与系统架构见 **[docs/ROADMAP.md](../docs/ROADMAP.md)**；API 见 **[backend/README.md](../backend/README.md)**。

---

## 架构

```text
┌─────────────────────────────────────────┐
│ Electron 主进程 (electron/ + Vite build) │
│   窗口 · 协议 · OAuth 深链 · 主题        │
└──────────────────┬──────────────────────┘
                   │ preload
┌──────────────────▼──────────────────────┐
│ Next.js App Router (src/app/)            │
│   (auth) 登录注册 · (main) 首页/规划/路线 │
│ components/plan  ← SSE 对话与工具 UI      │
│ service/       ← REST/SSE 客户端         │
│ lib/region-engine · terrain · Cesium    │
└──────────────────┬──────────────────────┘
                   │ NEXT_PUBLIC_API_BASE_URL
                   ▼
              Backend FastAPI
```

| 产物 | 命令输出 | 用途 |
|------|----------|------|
| `build/electron/` | `build:electron` | 主进程 / preload |
| `out/` | `build:frontend` | Next 静态导出（壳内加载） |
| `dist/` | `dist` | electron-builder 安装包 |

---

## 环境要求

- **Node.js 22.x**（`.nvmrc` / `.node-version`）
- npm 10+
- 本地开发需可访问后端（默认 http://127.0.0.1:8000）

```bash
cd frontend && npm install
```

可选 `frontend/.env.local`：

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Electron 二进制下载失败时：配置 `frontend/.npmrc` 中的 `electron_mirror` 或 `ELECTRON_MIRROR`（国内镜像）。

---

## 开发

| 命令 | 说明 |
|------|------|
| `npm run dev` | Electron + Next 联调（常用） |
| `npm run dev:next` | 仅 Next（浏览器） |
| `npm run dev:electron` | 仅主进程 watch |

`ELECTRON_DEVTOOLS=1 npm run dev` 打开 DevTools。

后端与数据库：仓库根 `python scripts/stack.py up` 或 [backend/README.md](../backend/README.md)。

---

## 构建与发布

| 命令 | 说明 |
|------|------|
| `npm run build:electron` | Vite 打包主进程 → `build/electron/` |
| `npm run build:frontend` | electron + Next 静态 → `out/` |
| `npm run dist` | 安装包 → `dist/` |
| `npm run build` | 含后端 Docker 镜像 + 前端安装包（全量） |
| `npm run preview` | 预览生产壳（不产出安装包） |

桌面 OAuth 与生产域配置见 [docs/production-deployment-and-multi-client-oauth.md](../docs/production-deployment-and-multi-client-oauth.md)。

---

## 目录结构

```text
frontend/
├── electron/              # 主进程、preload、auth/theme
├── src/app/               # 路由：(auth)、(main)/plan|routes|…
├── src/components/        # UI；plan/ 为对话与 artifact 预览
├── src/service/           # API 客户端与类型
├── src/i18n/              # 中英文文案
├── src/lib/               # region-engine、terrain、auth 密码信封等
├── vite.electron.config.ts
├── next.config.ts         # ELECTRON_BUILD 时 static export
└── electron-builder.yml
```

**规划对话 UI**：`PlanRuntimeProvider`、消息分片（工具调用、文件预览、PDF 等）在 `src/components/plan/`。

---

## 质量

```bash
npm run lint
npm run typecheck
npm test          # Vitest
```

### Git 钩子（仓库根）

`npm install` 启用 Husky。提交格式：`[feat]`、`[fix][ui]`、`[feat](electron)` 等；`commit-msg` 全仓库校验。

| 钩子 | 范围 |
|------|------|
| pre-commit | `frontend/` → ESLint + typecheck；`backend/` → Ruff/mypy/pytest |
| commit-msg | commitlint |

---

## 延伸阅读

- 区域 3D 地形：[docs/regional-terrain-engine-plan.md](../docs/regional-terrain-engine-plan.md)
- 能力地图与路线图：[docs/ROADMAP.md §4](../docs/ROADMAP.md)
