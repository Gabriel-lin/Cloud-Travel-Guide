"""Tests for pluggable search provider factory."""

from __future__ import annotations

import pytest

from backend.app.agents.tools.search.duckduckgo import DuckDuckGoSearchProvider
from backend.app.agents.tools.search.factory import (
    SearchProviderError,
    build_search_provider,
)
from backend.app.agents.tools.search.tavily import TavilySearchProvider
from backend.app.core.config import Settings, get_settings


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_auto_without_tavily_uses_duckduckgo():
    settings = Settings(
        agent_search_provider="auto",
        tavily_api_key="",
        secret_key="x" * 32,
        environment="development",
    )
    provider = build_search_provider(settings)
    assert isinstance(provider, DuckDuckGoSearchProvider)
    assert provider.name == "duckduckgo"


def test_auto_with_tavily_key_prefers_tavily():
    settings = Settings(
        agent_search_provider="auto",
        tavily_api_key="tvly-test-key",
        secret_key="x" * 32,
        environment="development",
    )
    provider = build_search_provider(settings)
    assert isinstance(provider, TavilySearchProvider)
    assert provider.name == "tavily"


def test_explicit_duckduckgo():
    settings = Settings(
        agent_search_provider="duckduckgo",
        tavily_api_key="tvly-ignored",
        secret_key="x" * 32,
        environment="development",
    )
    provider = build_search_provider(settings)
    assert isinstance(provider, DuckDuckGoSearchProvider)


def test_explicit_tavily_requires_key():
    settings = Settings(
        agent_search_provider="tavily",
        tavily_api_key="",
        secret_key="x" * 32,
        environment="development",
    )
    with pytest.raises(SearchProviderError):
        build_search_provider(settings)
