# Cloud Travel Guide — Frontend

生产级桌面前端：**Next.js + React** 渲染层，**Electron** 壳层，**Vite** 构建主进程/预加载脚本，**Tailwind CSS v4** 样式，**electron-builder** 打包，**Vitest**（Vite）单元测试。

## 架构

| 层级 | 技术 | 说明 |
|------|------|------|
| 渲染进程 | Next.js App Router | 开发时连 `http://127.0.0.1:3000` |
| 渲染页面 | Next.js 静态导出 | 输出到 `out/` |
| 主进程 / Preload | Electron + Vite（`build:electron`） | 输出到 `build/electron/` |
| 安装包 | electron-builder | 输出到 `dist/` |

## 环境要求

- Node.js **22.x**（见 `.nvmrc` / `.node-version`）
- npm 10+

## 安装

```bash
cd frontend
npm install
```

`npm install` 会通过 `prepare` 脚本自动安装 [Husky](https://typicode.github.io/husky/) Git 钩子（仓库根目录 `core.hooksPath` 指向 `frontend/.husky`）。克隆仓库后只需执行上述命令即可启用提交检查。

### Git 提交规范

提交信息须符合以下任一格式：

```
[feat] add map layer toggle
[feat][ui] add map layer toggle
[feat](ui) add map layer toggle
[fix][electron] load scene on cold start
```

允许的 `type`：`feat`、`fix`、`chore`、`misc`、`docs`、`refactor`、`test`、`ci`、`build`、`perf`、`style`。

可选 `scope`（填写时须在枚举内）：`ui`、`api`、`wasm`、`electron`、`build`、`ci`、`deps`、`config`、`docker`、`algo`、`db`、`test`。

| 钩子 | 检查内容 |
|------|----------|
| `pre-commit` | 暂存 `frontend/` 时：ESLint（`lint-staged`）+ `typecheck`；暂存 `backend/` 时：Ruff、mypy、pytest（见 `backend/.pre-commit-config.yaml`） |
| `commit-msg` | [commitlint](https://commitlint.js.org/) 校验提交说明（全仓库） |

跳过钩子（仅紧急情况）：`git commit --no-verify`。

若 Electron 二进制下载失败（国内网络），在 `frontend/.npmrc` 中取消注释 `electron_mirror`，或设置环境变量：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

## 开发

| 命令 | 说明 |
|------|------|
| `npm run dev` | Electron + Next 联调（Next、主进程 watch、Electron） |
| `npm run dev:next` | 仅 Next |
| `npm run dev:electron` | 仅主进程 watch |

可选：打开 DevTools — `ELECTRON_DEVTOOLS=1 npm run dev`

## 构建

| 命令 | 说明 |
|------|------|
| `npm run build` | 后端 Docker 镜像 + 前端 Electron 安装包 |
| `npm run build:backend` | `docker compose` 构建 FastAPI 镜像 |
| `npm run build:electron` | 主进程 → `build/electron/` |
| `npm run build:frontend` | `build:electron` + Next → `out/` + `dist` |
| `npm run dist` | electron-builder 打包安装包 → `dist/` |
| `npm run preview` | 本地预览生产壳层（不生成安装包） |

可执行安装包输出目录：`dist/`。

## 质量

```bash
npm run lint
npm run typecheck
npm test
```

## 目录结构

```
frontend/
├── electron/           # 主进程、preload、路径工具
├── build/electron/     # Vite 主进程产物（gitignore）
├── out/                # Next 静态导出（gitignore）
├── dist/               # electron-builder 安装包（gitignore）
├── src/app/            # Next.js 页面与布局
├── src/lib/            # 渲染进程工具（如 electron API 封装）
├── vite.config.ts      # Vitest + 路径别名
├── vite.electron.config.ts  # Vite 打包 Electron
├── next.config.ts      # ELECTRON_BUILD 时静态导出
└── electron-builder.yml
```
