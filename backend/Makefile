# Backend tasks — run from backend/ (Git Bash / WSL / Linux)
# Windows PowerShell: use equivalent `uv run ...` commands in README.md

.PHONY: dev serve lint fmt typecheck test check sync migrate

dev:
	uv run alembic upgrade head
	uv run python scripts/dev_server.py

serve:
	uv run alembic upgrade head
	uv run uvicorn backend.main:app --app-dir .. --host 0.0.0.0 --port 8000 --timeout-graceful-shutdown 5

lint:
	uv run ruff check .

fmt:
	uv run ruff format .

typecheck:
	cd .. && uv run --directory backend mypy

test:
	uv run pytest

check: lint typecheck test

migrate:
	uv run alembic upgrade head

sync:
	uv sync
