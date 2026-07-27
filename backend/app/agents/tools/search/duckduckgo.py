"""DuckDuckGo search provider (no API key required)."""

from __future__ import annotations

import asyncio
import logging

from backend.app.agents.tools.search.protocol import SearchResult

logger = logging.getLogger(__name__)


class DuckDuckGoSearchProvider:
    name = "duckduckgo"

    async def search(self, query: str, *, max_results: int = 5) -> list[SearchResult]:
        def _sync_search() -> list[SearchResult]:
            from duckduckgo_search import DDGS

            with DDGS() as ddgs:
                raw = list(ddgs.text(query, max_results=max_results))
            results: list[SearchResult] = []
            for item in raw:
                results.append(
                    SearchResult(
                        title=str(item.get("title") or ""),
                        url=str(item.get("href") or item.get("link") or ""),
                        snippet=str(item.get("body") or item.get("snippet") or ""),
                    )
                )
            return results

        try:
            return await asyncio.to_thread(_sync_search)
        except Exception:
            logger.exception("DuckDuckGo search failed for query=%r", query)
            raise
