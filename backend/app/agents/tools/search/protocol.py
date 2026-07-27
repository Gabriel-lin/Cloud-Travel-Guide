"""Pluggable web-search provider protocol."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class SearchResult:
    title: str
    url: str
    snippet: str


@runtime_checkable
class SearchProvider(Protocol):
    """Any search backend — swap via factory without changing tools."""

    name: str

    async def search(self, query: str, *, max_results: int = 5) -> list[SearchResult]:
        """Return ranked results for ``query``."""
        ...
