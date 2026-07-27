"""Read agent workspace files for chat previews / downloads."""

from __future__ import annotations

import base64
import mimetypes
from pathlib import Path

from backend.app.agents.tools.base import resolve_workspace_path
from backend.app.core.exceptions import AppError

MAX_WORKSPACE_FILE_BYTES = 10 * 1024 * 1024


def _mime_for_path(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed:
        return guessed
    ext = path.suffix.lower()
    if ext in {".md", ".markdown"}:
        return "text/markdown"
    if ext == ".pdf":
        return "application/pdf"
    return "application/octet-stream"


def read_workspace_file_base64(relative_path: str) -> dict[str, str]:
    """Return workspace file metadata + base64 payload for client preview."""
    path = relative_path.strip()
    if not path:
        raise AppError(code="INVALID_PATH", message="path is required", status_code=400)

    try:
        resolved = resolve_workspace_path(path)
    except ValueError as exc:
        raise AppError(
            code="INVALID_PATH",
            message=str(exc),
            status_code=400,
        ) from exc
    if not resolved.is_file():
        raise AppError(
            code="FILE_NOT_FOUND",
            message=f"workspace file not found: {path}",
            status_code=404,
        )

    size = resolved.stat().st_size
    if size > MAX_WORKSPACE_FILE_BYTES:
        raise AppError(
            code="FILE_TOO_LARGE",
            message=f"file exceeds {MAX_WORKSPACE_FILE_BYTES} bytes",
            status_code=413,
        )

    data = base64.b64encode(resolved.read_bytes()).decode("ascii")
    return {
        "path": path,
        "filename": resolved.name,
        "mimeType": _mime_for_path(resolved),
        "data": data,
    }
