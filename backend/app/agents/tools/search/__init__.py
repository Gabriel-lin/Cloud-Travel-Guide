"""Pluggable web search — protocol, providers, factory."""

from backend.app.agents.tools.search.factory import (
    SearchProviderError,
    build_search_provider,
    get_search_provider,
)
from backend.app.agents.tools.search.protocol import SearchProvider, SearchResult

__all__ = [
    "SearchProvider",
    "SearchProviderError",
    "SearchResult",
    "build_search_provider",
    "get_search_provider",
]
