"""Tavily search provider (requires TAVILY_API_KEY)."""

from __future__ import annotations

import logging

import httpx

from backend.app.agents.tools.search.protocol import SearchResult

logger = logging.getLogger(__name__)

TAVILY_SEARCH_URL = "https://api.tavily.com/search"


class TavilySearchProvider:
    name = "tavily"

    def __init__(self, api_key: str, *, timeout: float = 20.0) -> None:
        if not api_key.strip():
            raise ValueError("TavilySearchProvider requires a non-empty api_key")
        self._api_key = api_key
        self._timeout = timeout

    async def search(self, query: str, *, max_results: int = 5) -> list[SearchResult]:
        payload = {
            "api_key": self._api_key,
            "query": query,
            "max_results": max_results,
            "include_answer": False,
            "search_depth": "basic",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(TAVILY_SEARCH_URL, json=payload)
                response.raise_for_status()
                data = response.json()
        except Exception:
            logger.exception("Tavily search failed for query=%r", query)
            raise

        results: list[SearchResult] = []
        for item in data.get("results") or []:
            results.append(
                SearchResult(
                    title=str(item.get("title") or ""),
                    url=str(item.get("url") or ""),
                    snippet=str(item.get("content") or item.get("snippet") or ""),
                )
            )
        return results
