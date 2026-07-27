"""Geocode a place name via OpenStreetMap Nominatim."""

from __future__ import annotations

import logging

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


class GeocodeInput(BaseModel):
    place: str = Field(description="Place name, e.g. '成都市' or 'Tokyo Station'")
    limit: int = Field(default=3, ge=1, le=5)


def _geocode_place(place: str, limit: int = 3) -> str:
    params: dict[str, str | int] = {"q": place, "format": "json", "limit": limit}
    headers = {"User-Agent": "CloudTravelGuide/0.1 (agent-tool; contact=dev@local)"}
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(NOMINATIM_URL, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        logger.exception("geocode_place failed for %r", place)
        return dumps_json({"ok": False, "error": str(exc), "place": place})

    results = [
        {
            "display_name": item.get("display_name"),
            "lat": float(item["lat"]),
            "lon": float(item["lon"]),
            "type": item.get("type"),
        }
        for item in data
        if "lat" in item and "lon" in item
    ]
    return dumps_json({"ok": True, "place": place, "results": results})


def build_geocode_place_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="geocode_place",
        description="Resolve a place name to approximate latitude/longitude (Nominatim).",
        func=_geocode_place,
        args_schema=GeocodeInput,
    )
