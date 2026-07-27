#!/usr/bin/env python3
"""Cross-platform stack control (Windows / macOS / Ubuntu).

Uses Docker Compose v2 with production-safe flags:
  - merges base + overlay (dev or prod)
  - disables interactive menu (fixes Ctrl+C on Windows)
  - runs migrate one-shot before API/worker
  - short stop timeout

Examples (from repository root)::

    python scripts/stack.py up
    python scripts/stack.py up --watch
    python scripts/stack.py up --prod -d
    python scripts/stack.py down
    python scripts/stack.py logs -f backend
    python scripts/stack.py ps
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docker-compose.yml"
DEV = ROOT / "docker-compose.dev.yml"
PROD = ROOT / "docker-compose.prod.yml"
BACKEND_ENV = ROOT / "backend" / ".env"

_WEAK_SECRETS = frozenset(
    {
        "",
        "change-me",
        "change-me-in-production-use-openssl-rand-hex-32",
        "secret",
        "password",
        "changeme",
    }
)
_WEAK_DB_PASSWORDS = frozenset({"", "password", "postgres", "pass", "changeme"})


def _docker_compose() -> list[str]:
    if shutil.which("docker"):
        probe = subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True,
            text=True,
            check=False,
        )
        if probe.returncode == 0:
            return ["docker", "compose"]
    if shutil.which("docker-compose"):
        return ["docker-compose"]
    print(
        "Docker Compose not found. Install Docker Desktop (Win/Mac) "
        "or Docker Engine + compose plugin (Ubuntu).",
        file=sys.stderr,
    )
    raise SystemExit(127)


def _files(prod: bool) -> list[str]:
    overlay = PROD if prod else DEV
    for path in (BASE, overlay):
        if not path.is_file():
            print(f"Missing compose file: {path}", file=sys.stderr)
            raise SystemExit(1)
    return ["-f", str(BASE), "-f", str(overlay)]


def _compose_env(*, prod: bool) -> dict[str, str]:
    """Merge backend/.env into the process env for Compose interpolation."""
    extra: dict[str, str] = {}
    if BACKEND_ENV.is_file():
        extra.update(_parse_dotenv(BACKEND_ENV))
    if prod and "ENVIRONMENT" not in extra and "ENVIRONMENT" not in os.environ:
        extra["ENVIRONMENT"] = "production"
    return extra


def _run(args: list[str], *, env: dict[str, str] | None = None) -> int:
    merged = os.environ.copy()
    merged["COMPOSE_MENU"] = "0"
    if env:
        merged.update(env)
    print("+", " ".join(args), flush=True)
    return subprocess.call(args, cwd=str(ROOT), env=merged)


def _parse_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        values[key] = val
    return values


def _env_get(key: str, dotenv: dict[str, str]) -> str:
    return (os.environ.get(key) or dotenv.get(key) or "").strip()


def _validate_prod_secrets() -> int:
    """Fail fast on missing/weak production secrets and default DB passwords."""
    if not BACKEND_ENV.is_file():
        print(
            "Production requires backend/.env "
            "(SECRET_KEY, AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM, DATABASE_URL, etc.). "
            "Copy backend/.env.example and fill production values.",
            file=sys.stderr,
        )
        return 2

    dotenv = _parse_dotenv(BACKEND_ENV)
    errors: list[str] = []

    secret = _env_get("SECRET_KEY", dotenv)
    if secret.lower() in _WEAK_SECRETS or len(secret) < 32:
        errors.append(
            "SECRET_KEY must be set to a strong value (>=32 chars, not the example default)"
        )

    rsa = _env_get("AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM", dotenv)
    if not rsa or "..." in rsa or "BEGIN" not in rsa:
        errors.append(
            "AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM must be a real PEM private key "
            "(generate via: uv run python scripts/generate_password_rsa_key.py)"
        )

    pg_pass = _env_get("POSTGRES_PASSWORD", dotenv)
    db_url = _env_get("DATABASE_URL", dotenv)
    if not db_url:
        errors.append("DATABASE_URL must be set for production")
    else:
        match = re.search(r"://[^:]+:([^@]+)@", db_url)
        url_pass = match.group(1) if match else ""
        if url_pass.lower() in _WEAK_DB_PASSWORDS:
            errors.append(
                "DATABASE_URL must not use a default/weak DB password "
                "(e.g. 'password')"
            )

    if not pg_pass or pg_pass.lower() in _WEAK_DB_PASSWORDS:
        if not db_url or "postgres:" in db_url or "@postgres:" in db_url:
            errors.append(
                "POSTGRES_PASSWORD must be set to a non-default value "
                "(not 'password')"
            )

    env_name = _env_get("ENVIRONMENT", dotenv).lower()
    if env_name != "production":
        errors.append(
            "ENVIRONMENT must be 'production' for --prod "
            f"(got {(env_name or 'unset')!r})"
        )

    mock = _env_get("LLM_ALLOW_MOCK", dotenv).lower()
    if mock not in {"false", "0", "no"}:
        errors.append(
            "LLM_ALLOW_MOCK must be explicitly false in backend/.env for production"
        )

    if errors:
        print("Production preflight failed:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 2
    return 0


def _migrate(base_cmd: list[str], *, env: dict[str, str] | None = None) -> int:
    """Apply alembic migrations via the dedicated migrate service (not API startup)."""
    print("[stack] ensuring postgres is up for migrate…", flush=True)
    rc = _run([*base_cmd, "up", "-d", "--menu=false", "postgres"], env=env)
    if rc != 0:
        return rc
    print("[stack] running migrate…", flush=True)
    return _run([*base_cmd, "--profile", "migrate", "run", "--rm", "migrate"], env=env)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Cloud Travel Guide Docker stack")
    parser.add_argument(
        "--prod",
        action="store_true",
        help="Use production overlay (docker-compose.prod.yml)",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    up = sub.add_parser("up", help="Migrate, build, and start the stack")
    up.add_argument("-d", "--detach", action="store_true", help="Run in background")
    up.add_argument(
        "--watch",
        action="store_true",
        help="Dev only: sync code via Compose Watch (no uvicorn --reload)",
    )
    up.add_argument("--no-build", action="store_true")
    up.add_argument(
        "--skip-migrate",
        action="store_true",
        help="Skip the one-shot alembic migrate step",
    )

    sub.add_parser("down", help="Stop and remove containers")
    sub.add_parser("migrate", help="Run alembic upgrade head only")
    ps = sub.add_parser("ps", help="List containers")
    logs = sub.add_parser("logs", help="Tail service logs")
    logs.add_argument("-f", "--follow", action="store_true")
    logs.add_argument("service", nargs="*", help="Optional service names")

    pull = sub.add_parser("pull", help="Pull base images")
    build = sub.add_parser("build", help="Build images")
    build.add_argument("--no-cache", action="store_true")

    args = parser.parse_args(argv)
    dc = _docker_compose()
    files = _files(prod=args.prod)
    base_cmd = [*dc, *files, "--project-directory", str(ROOT)]
    compose_env = _compose_env(prod=args.prod)

    if args.prod and args.cmd in {"up", "build", "migrate"}:
        rc = _validate_prod_secrets()
        if rc != 0:
            return rc

    if args.cmd == "migrate":
        _run([*base_cmd, "--profile", "migrate", "build", "migrate"], env=compose_env)
        return _migrate(base_cmd, env=compose_env)

    if args.cmd == "up":
        if args.prod and args.watch:
            print("--watch is only for development overlay", file=sys.stderr)
            return 2
        if not args.skip_migrate:
            if not args.no_build:
                rc = _run(
                    [*base_cmd, "--profile", "migrate", "build", "migrate"],
                    env=compose_env,
                )
                if rc != 0:
                    return rc
            rc = _migrate(base_cmd, env=compose_env)
            if rc != 0:
                return rc
        cmd = [*base_cmd, "up", "--menu=false"]
        if not args.no_build:
            cmd.append("--build")
        if args.detach:
            cmd.append("-d")
        if args.watch:
            cmd.append("--watch")
        cmd.extend(["postgres", "docker-proxy", "backend", "sandbox-worker"])
        return _run(cmd, env=compose_env)

    if args.cmd == "down":
        return _run([*base_cmd, "down", "--timeout", "5", "--remove-orphans"], env=compose_env)

    if args.cmd == "ps":
        return _run([*base_cmd, "ps"], env=compose_env)

    if args.cmd == "logs":
        cmd = [*base_cmd, "logs"]
        if args.follow:
            cmd.append("-f")
        cmd.extend(args.service)
        return _run(cmd, env=compose_env)

    if args.cmd == "pull":
        return _run([*base_cmd, "pull"], env=compose_env)

    if args.cmd == "build":
        cmd = [*base_cmd, "build"]
        if args.no_cache:
            cmd.append("--no-cache")
        return _run(cmd, env=compose_env)

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
