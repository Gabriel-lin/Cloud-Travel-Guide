#!/usr/bin/env python3
"""Dev API server with reliable Ctrl+C / reload on Windows.

Why this exists
---------------
``uvicorn --reload`` on Windows often hangs on Ctrl+C (and on reload) when the
worker still has open connections — especially SSE streams from ``/plan/chat``.
Uvicorn's BaseReload calls ``process.join()`` with no timeout, so the reloader
never exits.

This script runs uvicorn **without** its built-in reloader and uses ``watchfiles``
to restart the process on Python changes. Watchfiles terminates the child on
SIGINT/SIGTERM, and we pass ``--timeout-graceful-shutdown`` so SSE connections
cannot block exit forever.

Usage (from ``backend/``)::

    uv run python scripts/dev_server.py
    uv run python scripts/dev_server.py --port 8000 --no-reload
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent

# Only these trees trigger a restart — never .venv / caches / workspace dumps.
WATCH_PATHS = (
    BACKEND_ROOT / "app",
    BACKEND_ROOT / "main.py",
    BACKEND_ROOT / "sandbox_worker",
)

GRACEFUL_SHUTDOWN_SEC = 2


def _uvicorn_cmd(*, host: str, port: int) -> list[str]:
    return [
        sys.executable,
        "-m",
        "uvicorn",
        "backend.main:app",
        "--app-dir",
        str(REPO_ROOT),
        "--host",
        host,
        "--port",
        str(port),
        "--timeout-graceful-shutdown",
        str(GRACEFUL_SHUTDOWN_SEC),
    ]


def _run_once(*, host: str, port: int) -> int:
    env = os.environ.copy()
    env.setdefault("PYTHONPATH", str(REPO_ROOT))
    # Ensure Ctrl+C reaches the child on Windows consoles.
    env.setdefault("PYTHONUNBUFFERED", "1")
    proc = subprocess.Popen(_uvicorn_cmd(host=host, port=port), env=env, cwd=str(BACKEND_ROOT))
    try:
        return int(proc.wait())
    except KeyboardInterrupt:
        _terminate(proc)
        return 0


def _terminate(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            # CTRL_BREAK_EVENT requires CREATE_NEW_PROCESS_GROUP; terminate is reliable.
            proc.terminate()
        else:
            proc.send_signal(signal.SIGTERM)
    except OSError:
        pass
    try:
        proc.wait(timeout=GRACEFUL_SHUTDOWN_SEC + 2)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def _run_with_reload(*, host: str, port: int) -> int:
    import shlex

    from watchfiles import DefaultFilter, run_process

    class BackendFilter(DefaultFilter):
        """Ignore caches / workspace dumps beyond DefaultFilter defaults."""

        ignore_dirs = (
            *DefaultFilter.ignore_dirs,
            "venv",
            ".ruff_cache",
            ".agent_workspace",
            "htmlcov",
        )

    watch = [str(p) for p in WATCH_PATHS if p.exists()]
    if not watch:
        watch = [str(BACKEND_ROOT / "app")]

    cmd = _uvicorn_cmd(host=host, port=port)
    # Always pass a shell command string — watchfiles target_type=command.
    cmd_str = subprocess.list2cmdline(cmd) if sys.platform == "win32" else shlex.join(cmd)

    print(
        f"[dev_server] watching {', '.join(watch)}\n"
        f"[dev_server] {cmd_str}\n"
        f"[dev_server] graceful shutdown timeout={GRACEFUL_SHUTDOWN_SEC}s "
        f"(fixes Windows Ctrl+C hang with SSE)",
        flush=True,
    )
    # sigint_timeout / sigkill_timeout: force-kill child if it ignores Ctrl+C
    # (uvicorn --reload's own join() has no timeout — that is the hang we avoid).
    run_process(
        *watch,
        target=cmd_str,
        target_type="command",
        watch_filter=BackendFilter(),
        callback=lambda changes: print(
            f"[dev_server] reload: {len(changes)} change(s)", flush=True
        ),
        sigint_timeout=GRACEFUL_SHUTDOWN_SEC + 1,
        sigkill_timeout=2,
    )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Cloud Travel Guide API dev server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--no-reload",
        action="store_true",
        help="Run once without file watching",
    )
    args = parser.parse_args()

    os.chdir(BACKEND_ROOT)
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))

    if args.no_reload:
        raise SystemExit(_run_once(host=args.host, port=args.port))
    raise SystemExit(_run_with_reload(host=args.host, port=args.port))


if __name__ == "__main__":
    main()
