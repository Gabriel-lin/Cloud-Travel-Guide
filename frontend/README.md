# Cloud Travel Guide — Frontend

基于 **Next.js 16**、**React 19**、**Tailwind CSS 4** 的前端；可选 **Electron** 桌面壳。

## 开发

```bash
npm install
npm run dev          # http://localhost:3000
```

## 构建与检查

```bash
npm run build        # Next.js 生产构建
npm run start        # 生产模式启动
npm run lint
npm test
```

## WSL 下开发说明

在 **WSL2** 里直接跑 Electron 常会报错：

`Missing X server or $DISPLAY`

这是因为 Linux 子系统默认没有桌面环境，不是项目代码问题。

**推荐做法（无需 Electron 窗口）：**

```bash
npm run dev
```

在 **Windows 浏览器** 打开 http://localhost:3000 即可调试页面。

若必须用 Electron 窗口，请任选其一：

| 方式 | 说明 |
|------|------|
| WSLg | Windows 11：`wsl --update` 后重启 WSL |
| X Server | Windows 安装 VcXsrv，启动后 `export DISPLAY=$(grep -m1 nameserver /etc/resolv.conf \| awk '{print $2}'):0` |
| Windows 终端 | 在 PowerShell / Git Bash 中 `cd frontend` 后执行 `npm run electron:dev` |

WSL 下请在本机 Windows 终端运行 `npm run electron:dev`；无图形环境时改用 `npm run dev`。

## Electron

推荐 **Node 24**（见 `.nvmrc`）：

```bash
nvm use 24
npm install              # postinstall 仅下载 Electron 二进制
npm run electron:dev     # Next(dev) + esbuild watch + Electron 窗口
```

| 命令 | 说明 |
|------|------|
| `npm run dev` | 仅 Web（Turbopack） |
| `npm run electron:build:main` | esbuild 打包主进程 → `build/electron/main.js` |
| `npm run electron:typecheck` | 主进程 TypeScript 类型检查 |
| `npm run electron:dev` | 桌面开发（Next Webpack + esbuild watch） |
| `npm run electron:preview` | 静态导出 + 本地 Electron 预览 |
| `npm run electron:build` | 静态导出 + electron-builder 打包 → `release/` |

打包配置见 `electron-builder.yml`（与 `package.json` 分离，符合 electron-builder 官方建议）。

开发时默认 **不打开 DevTools**；需要时在启动前设置 `ELECTRON_DEVTOOLS=1`。

Electron 安装若超时，可设置镜像：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

## 目录

- `src/app/` — App Router 页面与布局
- `src/components/` — 客户端图表组件
- `electron/src/` — Electron 主进程源码（`main.ts`、`paths.ts`）
- `electron/esbuild.mjs` — 主进程打包（输出 `build/electron/main.js`）
- `build/electron/` — 主进程构建产物（gitignore）
- `release/` — electron-builder 安装包输出（gitignore）
- `electron-builder.yml` — 打包配置
