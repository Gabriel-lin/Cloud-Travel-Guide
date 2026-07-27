"""Haversine distance and coarse transit-time estimate."""

from __future__ import annotations

import math

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json

EARTH_RADIUS_KM = 6371.0


class TransitGapInput(BaseModel):
    lat1: float
    lon1: float
    lat2: float
    lon2: float
    mode: str = Field(
        default="transit",
        description="walk | transit | drive — affects coarse speed assumption",
    )


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rlat1, rlon1, rlat2, rlon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _estimate_transit_gap(
    lat1: float, lon1: float, lat2: float, lon2: float, mode: str = "transit"
) -> str:
    distance_km = _haversine_km(lat1, lon1, lat2, lon2)
    speeds_kmh = {"walk": 4.5, "transit": 25.0, "drive": 40.0}
    speed = speeds_kmh.get(mode.lower(), speeds_kmh["transit"])
    # Road/network factor
    network_factor = 1.35 if mode.lower() != "walk" else 1.15
    effective_km = distance_km * network_factor
    minutes = (effective_km / speed) * 60.0
    risk = "ok"
    if minutes > 90:
        risk = "high_transfer_time"
    elif minutes > 45:
        risk = "tight_if_back_to_back"
    return dumps_json(
        {
            "ok": True,
            "straight_line_km": round(distance_km, 2),
            "effective_km": round(effective_km, 2),
            "mode": mode,
            "est_minutes": round(minutes, 1),
            "risk": risk,
            "note": "Coarse heuristic — not live traffic or timetable data.",
        }
    )


def build_estimate_transit_gap_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="estimate_transit_gap",
        description="Estimate distance and coarse travel time between two lat/lon points.",
        func=_estimate_transit_gap,
        args_schema=TransitGapInput,
    )
