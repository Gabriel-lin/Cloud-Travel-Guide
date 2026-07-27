"""Datetime utilities for agents."""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json


class EmptyInput(BaseModel):
    pass


class ConvertTimezoneInput(BaseModel):
    iso_datetime: str = Field(
        description="ISO 8601 datetime, e.g. '2026-07-20T10:00:00+08:00' or '2026-07-20T02:00:00Z'"
    )
    target_timezone: str = Field(
        description="IANA timezone, e.g. 'Asia/Shanghai', 'America/New_York', 'UTC'"
    )


def _current_datetime() -> str:
    now_utc = datetime.now(UTC)
    now_local = datetime.now().astimezone()
    return dumps_json(
        {
            "utc": now_utc.isoformat(),
            "local": now_local.isoformat(),
            "timezone": str(now_local.tzinfo),
        }
    )


def _convert_timezone(iso_datetime: str, target_timezone: str) -> str:
    try:
        raw = iso_datetime.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        tz = ZoneInfo(target_timezone)
        converted = dt.astimezone(tz)
    except ZoneInfoNotFoundError:
        return dumps_json(
            {
                "ok": False,
                "error": f"Unknown timezone: {target_timezone}",
                "hint": "Use IANA names like Asia/Shanghai",
            }
        )
    except Exception as exc:
        return dumps_json({"ok": False, "error": str(exc)})
    return dumps_json(
        {
            "ok": True,
            "input": iso_datetime,
            "target_timezone": target_timezone,
            "result": converted.isoformat(),
            "utc": converted.astimezone(UTC).isoformat(),
        }
    )


def build_current_datetime_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="current_datetime",
        description="Return current UTC and local timestamps (ISO 8601).",
        func=_current_datetime,
        args_schema=EmptyInput,
    )


def build_convert_timezone_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="convert_timezone",
        description="Convert an ISO datetime into a target IANA timezone.",
        func=_convert_timezone,
        args_schema=ConvertTimezoneInput,
    )
