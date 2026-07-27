"""Resolve SearchProvider from settings — swap vendors without touching tools."""

from __future__ import annotations

import logging
from functools import lru_cache

from backend.app.agents.tools.search.duckduckgo import DuckDuckGoSearchProvider
from backend.app.agents.tools.search.protocol import SearchProvider
from backend.app.agents.tools.search.tavily import TavilySearchProvider
from backend.app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


class SearchProviderError(RuntimeError):
    """Raised when the requested provider cannot be constructed."""


def build_search_provider(settings: Settings | None = None) -> SearchProvider:
    """
    Select provider by ``AGENT_SEARCH_PROVIDER``:

    - ``auto``: Tavily when ``TAVILY_API_KEY`` is set, else DuckDuckGo
    - ``duckduckgo`` / ``tavily``: explicit (tavily requires key)
    """
    cfg = settings or get_settings()
    mode = cfg.agent_search_provider

    if mode == "tavily":
        if not cfg.tavily_api_key:
            raise SearchProviderError("AGENT_SEARCH_PROVIDER=tavily requires TAVILY_API_KEY")
        return TavilySearchProvider(cfg.tavily_api_key)

    if mode == "duckduckgo":
        return DuckDuckGoSearchProvider()

    # auto
    if cfg.tavily_api_key:
        logger.debug("search provider auto → tavily")
        return TavilySearchProvider(cfg.tavily_api_key)
    logger.debug("search provider auto → duckduckgo")
    return DuckDuckGoSearchProvider()


@lru_cache
def get_search_provider() -> SearchProvider:
    return build_search_provider()
