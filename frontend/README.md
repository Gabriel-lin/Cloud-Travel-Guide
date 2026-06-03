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
