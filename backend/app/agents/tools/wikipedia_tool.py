"""Wikipedia lookup via LangChain WikipediaQueryRun."""

from __future__ import annotations

from functools import lru_cache

from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper
from langchain_core.tools import BaseTool


@lru_cache
def _wrapper() -> WikipediaAPIWrapper:
    # Chinese-first for Cloud Travel Guide; falls back gracefully on miss.
    return WikipediaAPIWrapper(
        wiki_client=None,
        lang="zh",
        top_k_results=2,
        doc_content_chars_max=2000,
    )


def build_wikipedia_tool() -> BaseTool:
    return WikipediaQueryRun(
        name="wikipedia",
        description=(
            "Look up encyclopedia background on places, landmarks, or cultural topics. "
            "Prefer for stable factual context; use web_search for live/business hours."
        ),
        api_wrapper=_wrapper(),
    )
