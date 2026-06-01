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
| Windows 终端 | 在 PowerShell 中 `cd frontend` 后执行 `npm run electron:dev` |

`npm run electron:start` 会优先使用 **WSLg**（`DISPLAY=:0`），不会误用 `resolv.conf` 里的 `8.8.8.8`。

若曾在 `~/.zshrc` 里设置过 `DISPLAY=$(grep nameserver ...)`，请先 `unset DISPLAY` 再启动。

仍失败时会打印上述提示。

## Electron

```bash
# 开发：Next 开发服务器 + Electron 窗口（需图形环境）
npm run electron:dev

# 静态导出并本地运行 Electron
npm run electron

# 打包安装包（需先 static export）
npm run electron:build
```

Electron 安装若超时，可设置镜像后重装：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm install electron --save-dev
```

## 目录

- `src/app/` — App Router 页面与布局
- `src/components/` — 客户端图表组件
- `electron/main.js` — Electron 主进程
