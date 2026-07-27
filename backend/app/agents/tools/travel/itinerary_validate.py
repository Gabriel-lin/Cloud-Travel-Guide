"""Itinerary skeleton validation and structure checks."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json


class SkeletonInput(BaseModel):
    skeleton_json: str = Field(
        description=(
            'JSON string: {"destination": str, "days": ['
            '{"day": 1, "theme": str, "stops": [{"name": str, "slot": "morning|afternoon|evening"}]}]}'
        )
    )


class ValidateInput(BaseModel):
    itinerary_json: str = Field(
        description="JSON itinerary with days[].stops[] (same shape as draft_day_skeleton)"
    )


def _parse_json(raw: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"Invalid JSON: {exc}"
    if not isinstance(data, dict):
        return None, "Root must be a JSON object"
    return data, None


def _normalize_skeleton(data: dict[str, Any]) -> dict[str, Any]:
    days_in = data.get("days") or []
    days_out: list[dict[str, Any]] = []
    issues: list[str] = []
    if not isinstance(days_in, list) or not days_in:
        issues.append("days must be a non-empty list")
    for i, day in enumerate(days_in if isinstance(days_in, list) else []):
        if not isinstance(day, dict):
            issues.append(f"days[{i}] must be an object")
            continue
        day_num = day.get("day", i + 1)
        stops_in = day.get("stops") or []
        stops_out: list[dict[str, Any]] = []
        if not isinstance(stops_in, list):
            issues.append(f"day {day_num}: stops must be a list")
            stops_in = []
        for j, stop in enumerate(stops_in):
            if not isinstance(stop, dict) or not stop.get("name"):
                issues.append(f"day {day_num} stop[{j}]: need object with name")
                continue
            slot = str(stop.get("slot") or "afternoon").lower()
            if slot not in {"morning", "afternoon", "evening"}:
                issues.append(f"day {day_num} stop[{j}]: invalid slot {slot}")
                slot = "afternoon"
            stops_out.append({"name": str(stop["name"]), "slot": slot})
        if len(stops_out) > 5:
            issues.append(f"day {day_num}: more than 5 stops — likely too dense")
        days_out.append(
            {
                "day": int(day_num) if str(day_num).isdigit() else i + 1,
                "theme": str(day.get("theme") or ""),
                "stops": stops_out,
            }
        )
    return {
        "destination": str(data.get("destination") or ""),
        "days": days_out,
        "issues": issues,
        "ok": len(issues) == 0,
    }


def _draft_day_skeleton(skeleton_json: str) -> str:
    data, err = _parse_json(skeleton_json)
    if err or data is None:
        return dumps_json({"ok": False, "error": err})
    normalized = _normalize_skeleton(data)
    return dumps_json(normalized)


def _validate_itinerary(itinerary_json: str) -> str:
    data, err = _parse_json(itinerary_json)
    if err or data is None:
        return dumps_json({"ok": False, "error": err})
    normalized = _normalize_skeleton(data)
    warnings: list[str] = list(normalized.get("issues") or [])
    for day in normalized.get("days") or []:
        slots = [s.get("slot") for s in day.get("stops") or []]
        if slots.count("morning") > 2:
            warnings.append(f"day {day.get('day')}: too many morning stops")
        if len(day.get("stops") or []) == 0:
            warnings.append(f"day {day.get('day')}: empty day")
    severity = "pass"
    if any("dense" in w or "more than 5" in w for w in warnings):
        severity = "fail"
    elif warnings:
        severity = "warn"
    return dumps_json(
        {
            "ok": severity != "fail",
            "severity": severity,
            "warnings": warnings,
            "normalized": {
                "destination": normalized.get("destination"),
                "days": normalized.get("days"),
            },
        }
    )


def build_draft_day_skeleton_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="draft_day_skeleton",
        description="Normalize/validate a day-by-day itinerary skeleton JSON.",
        func=_draft_day_skeleton,
        args_schema=SkeletonInput,
    )


def build_validate_itinerary_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="validate_itinerary",
        description="Heuristic validation of itinerary structure and density issues.",
        func=_validate_itinerary,
        args_schema=ValidateInput,
    )
