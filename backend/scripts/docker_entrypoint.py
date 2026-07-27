"""Container entrypoint — signal-safe, CRLF-safe, drops root before exec.

Modes:
  migrate — alembic upgrade head (one-shot; stack.py runs this before API)
  api     — uvicorn (no migrate; schema applied by migrate service)
  worker  — sandbox worker
"""

from __future__ import annotations

import contextlib
import os
import subprocess
import sys
from pathlib import Path


def _drop_to_appuser() -> None:
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        return
    uid = int(os.environ.get("APP_UID", "10001"))
    gid = int(os.environ.get("APP_GID", "10001"))
    os.setgid(gid)
    os.setuid(uid)
    print(f"[entrypoint] dropped privileges to {uid}:{gid}", flush=True)


def _ensure_workspace_and_drop_privileges() -> None:
    """Fix named-volume ownership when started as root, then drop to APP_UID."""
    workspace = os.environ.get("AGENT_WORKSPACE_DIR", "/app/backend/.agent_workspace")
    uid = int(os.environ.get("APP_UID", "10001"))
    gid = int(os.environ.get("APP_GID", "10001"))
    path = Path(workspace)
    font_cache = Path(os.environ.get("FONTCONFIG_CACHEDIR", "/tmp/fontconfig"))

    with contextlib.suppress(OSError):
        path.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        font_cache.mkdir(parents=True, exist_ok=True)

    if hasattr(os, "geteuid") and os.geteuid() == 0:
        try:
            os.chown(path, uid, gid)
            for root, dirs, files in os.walk(path):
                with contextlib.suppress(OSError):
                    os.chown(root, uid, gid)
                for name in dirs + files:
                    with contextlib.suppress(OSError):
                        os.chown(os.path.join(root, name), uid, gid)
        except OSError as exc:
            print(f"[entrypoint] workspace chown warning: {exc}", flush=True)

    _drop_to_appuser()


def _migrate() -> None:
    print("[entrypoint] alembic upgrade head", flush=True)
    subprocess.check_call([sys.executable, "-m", "alembic", "upgrade", "head"])


def main(argv: list[str]) -> None:
    mode = argv[1] if len(argv) > 1 else "api"

    if mode not in {"api", "worker", "migrate"}:
        print(
            f"[entrypoint] unknown mode: {mode!r} (expected api|worker|migrate)",
            flush=True,
        )
        raise SystemExit(2)

    if mode in {"api", "worker"}:
        _ensure_workspace_and_drop_privileges()
    elif mode == "migrate":
        _drop_to_appuser()

    if mode == "migrate":
        _migrate()
        print("[entrypoint] migrate complete", flush=True)
        return

    if mode == "api":
        host = os.environ.get("UVICORN_HOST", "0.0.0.0")
        port = os.environ.get("UVICORN_PORT", "8000")
        # Single worker: SSE /plan/chat must stay on one process.
        graceful = os.environ.get("UVICORN_TIMEOUT_GRACEFUL_SHUTDOWN", "5")
        cmd = [
            sys.executable,
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            host,
            "--port",
            port,
            "--timeout-graceful-shutdown",
            graceful,
        ]
        print(f"[entrypoint] exec {' '.join(cmd)}", flush=True)
        os.execvp(cmd[0], cmd)

    if mode == "worker":
        cmd = [sys.executable, "-m", "backend.sandbox_worker"]
        print(f"[entrypoint] exec {' '.join(cmd)}", flush=True)
        os.execvp(cmd[0], cmd)


if __name__ == "__main__":
    main(sys.argv)
