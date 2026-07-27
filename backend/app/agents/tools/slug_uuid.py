"""UUID / slug helpers for naming drafts and workspace files."""

from __future__ import annotations

import re
import uuid

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json


class EmptyInput(BaseModel):
    pass


class SlugifyInput(BaseModel):
    text: str = Field(description="Human-readable title to turn into a filename-safe slug")
    max_length: int = Field(default=64, ge=8, le=128)


def _generate_uuid() -> str:
    return dumps_json({"ok": True, "uuid": str(uuid.uuid4())})


def _slugify(text: str, max_length: int = 64) -> str:
    lowered = text.strip().lower()
    # Keep CJK letters/digits; replace other runs with '-'
    slug = re.sub(r"[^\w\u4e00-\u9fff]+", "-", lowered, flags=re.UNICODE)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    if not slug:
        slug = "draft"
    slug = slug[:max_length].rstrip("-")
    return dumps_json({"ok": True, "slug": slug, "source": text})


def build_generate_uuid_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="generate_uuid",
        description="Generate a random UUID (v4), useful for draft filenames and ids.",
        func=_generate_uuid,
        args_schema=EmptyInput,
    )


def build_slugify_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="slugify",
        description="Convert a title into a filesystem-safe slug for workspace files.",
        func=_slugify,
        args_schema=SlugifyInput,
    )
