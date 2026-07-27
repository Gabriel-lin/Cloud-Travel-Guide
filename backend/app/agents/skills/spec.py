"""SkillSpec dataclass - kept separate to avoid circular imports with skill modules."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class SkillSpec:
    """
    A skill bundles prompt guidance + preferred tools for a task family.

    Phase 1: prompt sections are composed into the system prompt.
    Phase 2: preferred_tools feed the LangGraph tool allowlist.
    """

    id: str
    name: str
    description: str
    prompt_sections: tuple[str, ...]
    preferred_tools: tuple[str, ...] = ()
    workflows: tuple[str, ...] = ()
    exception_playbooks: tuple[str, ...] = ()
