"""Tests for markdown → PDF export."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

try:
    import weasyprint  # noqa: F401
except (ImportError, OSError):
    pytest.skip(
        "WeasyPrint is not available (missing package or native libraries)",
        allow_module_level=True,
    )

from backend.app.agents.tools import get_tool_registry
from backend.app.agents.tools.base import resolve_workspace_path
from backend.app.agents.tools.files import clear_file_toolkit_cache
from backend.app.core.config import get_settings
from backend.app.services.document_export import convert_markdown_file_to_pdf


@pytest.fixture()
def sandbox(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("AGENT_WORKSPACE_DIR", str(tmp_path))
    get_settings.cache_clear()
    clear_file_toolkit_cache()
    get_tool_registry.cache_clear()
    yield tmp_path
    get_settings.cache_clear()
    clear_file_toolkit_cache()
    get_tool_registry.cache_clear()


def test_resolve_workspace_path_rejects_escape(sandbox: Path) -> None:
    with pytest.raises(ValueError, match="escapes workspace"):
        resolve_workspace_path("../outside.md")


def test_convert_markdown_file_to_pdf(sandbox: Path) -> None:
    source = sandbox / "trip.md"
    source.write_text("# 川西环线\n\n- Day 1: 成都\n- Day 2: 四姑娘山\n", encoding="utf-8")

    output = convert_markdown_file_to_pdf("trip.md")
    assert output.is_file()
    assert output.suffix == ".pdf"
    assert output.stat().st_size > 500


def test_convert_markdown_to_pdf_tool(sandbox: Path) -> None:
    (sandbox / "guide.md").write_text("## 美食\n\n牦牛肉火锅\n", encoding="utf-8")
    tool = get_tool_registry().get("convert_markdown_to_pdf").factory()
    payload = json.loads(tool.invoke({"source_path": "guide.md"}))
    assert payload["ok"] is True
    assert payload["outputPath"] == "guide.pdf"
    assert (sandbox / "guide.pdf").is_file()
