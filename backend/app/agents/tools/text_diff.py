"""Text diff utility — useful when revising itineraries."""

from __future__ import annotations

import difflib

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json


class TextDiffInput(BaseModel):
    before: str = Field(description="Original text")
    after: str = Field(description="Revised text")
    context_lines: int = Field(default=2, ge=0, le=10)


def _text_diff(before: str, after: str, context_lines: int = 2) -> str:
    before_lines = before.splitlines()
    after_lines = after.splitlines()
    diff = list(
        difflib.unified_diff(
            before_lines,
            after_lines,
            fromfile="before",
            tofile="after",
            lineterm="",
            n=context_lines,
        )
    )
    matcher = difflib.SequenceMatcher(None, before, after)
    return dumps_json(
        {
            "ok": True,
            "similarity_ratio": round(matcher.ratio(), 4),
            "changed": before != after,
            "unified_diff": "\n".join(diff) if diff else "(no differences)",
        }
    )


def build_text_diff_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="text_diff",
        description=(
            "Compare two texts and return a unified diff plus similarity ratio. "
            "Useful when reviewing itinerary revisions."
        ),
        func=_text_diff,
        args_schema=TextDiffInput,
    )
