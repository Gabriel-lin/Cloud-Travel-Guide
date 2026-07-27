"""LangChain web_search tool backed by pluggable SearchProvider."""

from __future__ import annotations

import asyncio
import logging

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json
from backend.app.agents.tools.search.factory import get_search_provider

logger = logging.getLogger(__name__)


class WebSearchInput(BaseModel):
    query: str = Field(description="Search query")
    max_results: int = Field(default=5, ge=1, le=10, description="Max results (1-10)")


def _web_search(query: str, max_results: int = 5) -> str:
    provider = get_search_provider()

    async def _run() -> str:
        try:
            results = await provider.search(query, max_results=max_results)
        except Exception as exc:
            logger.exception("web_search failed via provider=%s", provider.name)
            return dumps_json(
                {
                    "ok": False,
                    "provider": provider.name,
                    "error": str(exc),
                    "hint": "Degrade: do not invent live facts; ask user or use prior knowledge carefully.",
                }
            )
        return dumps_json(
            {
                "ok": True,
                "provider": provider.name,
                "query": query,
                "results": [
                    {"title": r.title, "url": r.url, "snippet": r.snippet} for r in results
                ],
            }
        )

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # Sync tool invoked from async context — run in a fresh loop via thread.
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, _run()).result()
    return asyncio.run(_run())


def build_web_search_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="web_search",
        description=(
            "Search the public web. Uses the configured SearchProvider "
            "(DuckDuckGo by default; Tavily when TAVILY_API_KEY is set)."
        ),
        func=_web_search,
        args_schema=WebSearchInput,
    )
