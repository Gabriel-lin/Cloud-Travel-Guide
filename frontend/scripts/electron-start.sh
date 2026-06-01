#!/usr/bin/env bash
set -euo pipefail

# 判断 DISPLAY 是否像有效的主机:端口（排除 8.8.8.8 等公网 DNS）
is_plausible_display() {
  local d="${1:-}"
  [ -n "$d" ] || return 1
  case "$d" in
    :*) return 0 ;;
    localhost:* | 127.0.0.1:*) return 0 ;;
  esac
  if [[ "$d" =~ ^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)[0-9.]+: ]]; then
    return 0
  fi
  return 1
}

setup_wsl_display() {
  # WSLg 优先：/mnt/wslg 存在时必须用 :0，勿用 resolv 里的 DNS
  if [ -d /mnt/wslg ]; then
    export DISPLAY=:0
    export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
    return 0
  fi

  if is_plausible_display "${DISPLAY:-}"; then
    return 0
  fi

  unset DISPLAY

  if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    export DISPLAY=:0
    return 0
  fi

  if grep -qi microsoft /proc/version 2>/dev/null; then
    local host

    # WSL2 默认网关一般是 Windows 主机 IP
    host="$(ip route show default 2>/dev/null | awk '{print $3; exit}' || true)"

    # 否则从 resolv.conf 取「私网」nameserver（跳过 8.8.8.8 等）
    if [ -z "$host" ]; then
      host="$(
        awk '/^nameserver / {
          ip=$2
          if (ip ~ /^10\./ || ip ~ /^192\.168\./ || ip ~ /^172\.(1[6-9]|2[0-9]|3[0-1])\./) print ip
        }' /etc/resolv.conf 2>/dev/null | tail -1
      )"
    fi

    if [ -n "$host" ]; then
      export DISPLAY="${host}:0"
      return 0
    fi
  fi

  return 1
}

if ! setup_wsl_display; then
  cat <<'EOF' >&2

Electron 需要图形界面，当前环境没有可用的 DISPLAY。

在 WSL 中可选方案：
  1. 仅 Web 开发（推荐）：npm run dev
     然后在 Windows 浏览器打开 http://localhost:3000

  2. 启用 WSLg（Windows 11）：
     wsl --update
     重启 WSL 后重试 npm run electron:dev

  3. 使用 X Server（VcXsrv / X410）：
     在 Windows 启动 X Server 并允许连接后执行：
     export DISPLAY=$(ip route show default | awk '{print $3}'):0
     npm run electron:dev

  4. 在 Windows 本机终端（PowerShell / CMD）进入 frontend 目录运行 electron:dev

若 shell 里曾设置过错误的 DISPLAY=8.8.8.8，请先执行：unset DISPLAY

EOF
  exit 1
fi

echo "Using DISPLAY=${DISPLAY}"

exec electron electron/main.js --no-sandbox "$@"
