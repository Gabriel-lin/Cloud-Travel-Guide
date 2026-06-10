# Backend tasks — run from backend/ (Git Bash / WSL / Linux)
# Windows PowerShell: use equivalent `uv run ...` commands in README.md

.PHONY: dev serve lint fmt typecheck test check sync

dev:
	uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000

serve:
	uv run uvicorn main:app --host 0.0.0.0 --port 8000

lint:
	uv run ruff check .

fmt:
	uv run ruff format .

typecheck:
	cd .. && uv run --directory backend mypy

test:
	uv run pytest

check: lint typecheck test

sync:
	uv sync
