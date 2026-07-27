"""Weather summary via Open-Meteo (no API key)."""

from __future__ import annotations

import logging

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


class WeatherInput(BaseModel):
    lat: float = Field(description="Latitude")
    lon: float = Field(description="Longitude")
    days: int = Field(default=3, ge=1, le=7, description="Forecast days")


def _weather_summary(lat: float, lon: float, days: int = 3) -> str:
    params: dict[str, str | int | float] = {
        "latitude": lat,
        "longitude": lon,
        "daily": "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum",
        "forecast_days": days,
        "timezone": "auto",
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(OPEN_METEO_URL, params=params)
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        logger.exception("weather_summary failed for %s,%s", lat, lon)
        return dumps_json({"ok": False, "error": str(exc), "lat": lat, "lon": lon})

    daily = data.get("daily") or {}
    days_out = []
    times = daily.get("time") or []
    for i, day in enumerate(times):
        days_out.append(
            {
                "date": day,
                "temp_max_c": (daily.get("temperature_2m_max") or [None])[i]
                if i < len(daily.get("temperature_2m_max") or [])
                else None,
                "temp_min_c": (daily.get("temperature_2m_min") or [None])[i]
                if i < len(daily.get("temperature_2m_min") or [])
                else None,
                "precip_mm": (daily.get("precipitation_sum") or [None])[i]
                if i < len(daily.get("precipitation_sum") or [])
                else None,
                "weathercode": (daily.get("weathercode") or [None])[i]
                if i < len(daily.get("weathercode") or [])
                else None,
            }
        )
    return dumps_json(
        {
            "ok": True,
            "lat": lat,
            "lon": lon,
            "timezone": data.get("timezone"),
            "daily": days_out,
            "note": "Open-Meteo weathercode; interpret cautiously for packing advice.",
        }
    )


def build_weather_summary_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="weather_summary",
        description="Fetch a short multi-day weather forecast for lat/lon (Open-Meteo).",
        func=_weather_summary,
        args_schema=WeatherInput,
    )
