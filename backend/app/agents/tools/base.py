"""Tool helpers shared across the agent tool library."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.app.core.config import get_settings


def workspace_root() -> Path:
    """Resolve and ensure the agent workspace directory (LangChain file toolkit root_dir)."""
    settings = get_settings()
    raw = Path(settings.agent_workspace_dir)
    root = raw if raw.is_absolute() else Path.cwd() / raw
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def resolve_workspace_path(relative_path: str) -> Path:
    """Resolve a workspace-relative path and reject escapes outside the root."""
    root = workspace_root()
    candidate = (root / relative_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"path escapes workspace: {relative_path}") from exc
    return candidate


def workspace_relative(path: Path) -> str:
    """Return a posix path relative to the agent workspace root."""
    root = workspace_root()
    return path.resolve().relative_to(root).as_posix()


def dumps_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)
