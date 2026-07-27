"""Pace density scoring for itineraries."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json


class PaceInput(BaseModel):
    itinerary_json: str = Field(
        description="JSON with days[].stops[] — same shape as validate_itinerary"
    )


def _score_pace(itinerary_json: str) -> str:
    try:
        data = json.loads(itinerary_json)
    except json.JSONDecodeError as exc:
        return dumps_json({"ok": False, "error": f"Invalid JSON: {exc}"})
    if not isinstance(data, dict):
        return dumps_json({"ok": False, "error": "Root must be an object"})

    days = data.get("days") or []
    if not isinstance(days, list) or not days:
        return dumps_json({"ok": False, "error": "days must be a non-empty list"})

    per_day: list[dict[str, Any]] = []
    scores: list[float] = []
    for i, day in enumerate(days):
        if not isinstance(day, dict):
            continue
        stops = day.get("stops") or []
        n = len(stops) if isinstance(stops, list) else 0
        # Ideal ~2-3 stops/day
        if n <= 2:
            score = 0.9
            label = "relaxed"
        elif n == 3:
            score = 0.75
            label = "balanced"
        elif n == 4:
            score = 0.45
            label = "busy"
        else:
            score = 0.2
            label = "overpacked"
        scores.append(score)
        per_day.append(
            {
                "day": day.get("day", i + 1),
                "stops": n,
                "score": score,
                "label": label,
            }
        )

    overall = sum(scores) / len(scores) if scores else 0.0
    verdict = "ok"
    if overall < 0.4:
        verdict = "too_intense"
    elif overall < 0.6:
        verdict = "borderline"
    return dumps_json(
        {
            "ok": True,
            "overall_score": round(overall, 2),
            "verdict": verdict,
            "per_day": per_day,
            "guidance": "Aim for 2–3 meaningful stops/day with buffer for meals and transit.",
        }
    )


def build_score_pace_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="score_pace",
        description="Score itinerary pace density (stops per day / overcrowding risk).",
        func=_score_pace,
        args_schema=PaceInput,
    )
