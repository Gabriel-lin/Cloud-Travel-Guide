"""JSON parse / pretty-print utilities."""

from __future__ import annotations

import json

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json


class JsonParseInput(BaseModel):
    text: str = Field(description="JSON string to parse and validate")


class JsonPrettyInput(BaseModel):
    text: str = Field(description="JSON string to pretty-print")
    indent: int = Field(default=2, ge=0, le=8)


def _json_parse(text: str) -> str:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return dumps_json({"ok": False, "error": str(exc)})
    return dumps_json(
        {
            "ok": True,
            "type": type(data).__name__,
            "value": data,
        }
    )


def _json_pretty(text: str, indent: int = 2) -> str:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return dumps_json({"ok": False, "error": str(exc)})
    return json.dumps(data, ensure_ascii=False, indent=indent)


def build_json_parse_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="json_parse",
        description="Parse and validate a JSON string; return typed structure summary.",
        func=_json_parse,
        args_schema=JsonParseInput,
    )


def build_json_pretty_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="json_pretty",
        description="Pretty-print a JSON string for readable itinerary / config drafts.",
        func=_json_pretty,
        args_schema=JsonPrettyInput,
    )
