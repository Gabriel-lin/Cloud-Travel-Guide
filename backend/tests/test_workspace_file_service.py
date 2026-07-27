"""Tests for workspace file read API."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.agents.tools.base import resolve_workspace_path
from backend.app.core.config import get_settings
from backend.app.core.exceptions import AppError
from backend.app.services.workspace_file_service import read_workspace_file_base64


@pytest.fixture()
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("AGENT_WORKSPACE_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def test_read_workspace_file_base64(workspace: Path) -> None:
    pdf = workspace / "trip.pdf"
    pdf.write_bytes(b"%PDF-1.4 test")

    payload = read_workspace_file_base64("trip.pdf")
    assert payload["filename"] == "trip.pdf"
    assert payload["mimeType"] == "application/pdf"
    assert payload["data"]


def test_read_workspace_file_rejects_escape(workspace: Path) -> None:
    with pytest.raises(ValueError, match="escapes workspace"):
        resolve_workspace_path("../outside.pdf")

    with pytest.raises(AppError) as exc:
        read_workspace_file_base64("../outside.pdf")
    assert exc.value.status_code == 400
