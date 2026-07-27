"""Tests for LangChain file tools and project-specific travel tools."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.app.agents.tools import get_tool_registry
from backend.app.agents.tools.files import clear_file_toolkit_cache
from backend.app.core.config import get_settings


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


def test_langchain_file_tools_write_read_list(sandbox: Path):
    registry = get_tool_registry()
    write = registry.get("write_file").factory()
    read = registry.get("read_file").factory()
    listing = registry.get("list_directory").factory()

    # LangChain WriteFileTool: file_path + text
    write.invoke({"file_path": "notes/day1.md", "text": "# hello"})
    assert (sandbox / "notes" / "day1.md").is_file()

    content = read.invoke({"file_path": "notes/day1.md"})
    assert "# hello" in content

    listed = listing.invoke({"dir_path": "notes"})
    assert "day1.md" in listed


def test_langchain_file_tools_reject_path_escape(sandbox: Path):
    write = get_tool_registry().get("write_file").factory()
    result = write.invoke({"file_path": "../outside.txt", "text": "nope"})
    # Toolkit returns an error string rather than writing outside root_dir
    assert (sandbox / "outside.txt").exists() is False
    assert isinstance(result, str)
    assert "outside.txt" not in [p.name for p in sandbox.iterdir()]


def test_tool_registry_resolves_common_tools():
    registry = get_tool_registry()
    tools = registry.resolve(["web_search", "current_datetime", "estimate_budget"])
    names = {t.name for t in tools}
    assert names == {"web_search", "current_datetime", "estimate_budget"}


def test_calculator_and_timezone_tools():
    registry = get_tool_registry()
    calc = registry.get("calculator").factory()
    out = json.loads(calc.invoke({"expression": "(550*3*2)+800"}))
    assert out["ok"] is True
    assert out["result"] == 550 * 3 * 2 + 800

    tz = registry.get("convert_timezone").factory()
    converted = json.loads(
        tz.invoke(
            {
                "iso_datetime": "2026-07-20T02:00:00+00:00",
                "target_timezone": "Asia/Shanghai",
            }
        )
    )
    assert converted["ok"] is True
    assert "+08:00" in converted["result"]


def test_extra_common_utilities():
    registry = get_tool_registry()

    units = json.loads(
        registry.get("convert_units")
        .factory()
        .invoke({"value": 10, "from_unit": "km", "to_unit": "mi"})
    )
    assert units["ok"] is True
    assert units["value"] == pytest.approx(6.21371, rel=1e-3)

    parsed = json.loads(registry.get("json_parse").factory().invoke({"text": '{"a": 1}'}))
    assert parsed["ok"] is True
    assert parsed["value"] == {"a": 1}

    diff = json.loads(
        registry.get("text_diff").factory().invoke({"before": "Day1\nA", "after": "Day1\nB"})
    )
    assert diff["ok"] is True
    assert diff["changed"] is True

    slug = json.loads(registry.get("slugify").factory().invoke({"text": "成都 3日游!"}))
    assert slug["ok"] is True
    assert "成都" in slug["slug"] or "3" in slug["slug"]

    uid = json.loads(registry.get("generate_uuid").factory().invoke({}))
    assert uid["ok"] is True
    assert len(uid["uuid"]) == 36


def test_common_tool_ids_include_expanded_basics():
    from backend.app.agents.tools import COMMON_TOOL_IDS

    for tid in (
        "wikipedia",
        "calculator",
        "convert_timezone",
        "convert_units",
        "convert_currency",
        "json_parse",
        "text_diff",
        "slugify",
        "copy_file",
        "file_search",
        "file_delete",
        "get_current_plan",
        "run_sandbox_job",
        "cancel_sandbox_job",
    ):
        assert tid in COMMON_TOOL_IDS
        assert get_tool_registry().get(tid).factory().name == tid


def test_budget_and_pace_tools():
    registry = get_tool_registry()
    budget = registry.get("estimate_budget").factory()
    result = json.loads(budget.invoke({"days": 3, "party_size": 2, "tier": "mid"}))
    assert result["ok"] is True
    assert result["estimated_total"] > 0

    pace = registry.get("score_pace").factory()
    itinerary = {
        "days": [
            {"day": 1, "stops": [{"name": "A"}, {"name": "B"}]},
            {"day": 2, "stops": [{"name": "C"}] * 6},
        ]
    }
    scored = json.loads(pace.invoke({"itinerary_json": json.dumps(itinerary)}))
    assert scored["ok"] is True
    assert "per_day" in scored
