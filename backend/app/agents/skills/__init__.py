"""Skill registry - composable capability packs for builtin agents."""

from __future__ import annotations

from collections.abc import Sequence
from functools import lru_cache
from typing import Any

from backend.app.agents.skills.spec import SkillSpec

__all__ = [
    "BASE_SKILL_IDS",
    "CRITIC_SKILL_IDS",
    "GUIDE_SKILL_IDS",
    "PLANNER_SKILL_IDS",
    "SkillRegistry",
    "SkillSpec",
    "get_skill_registry",
]


class SkillRegistry:
    def __init__(self, skills: Sequence[SkillSpec]) -> None:
        self._skills = {s.id: s for s in skills}

    def get(self, skill_id: str) -> SkillSpec:
        if skill_id not in self._skills:
            raise KeyError(f"Unknown skill: {skill_id}")
        return self._skills[skill_id]

    def resolve(self, skill_ids: Sequence[str]) -> list[SkillSpec]:
        return [self.get(sid) for sid in skill_ids]

    def compose_prompt_block(self, skill_ids: Sequence[str]) -> str:
        parts: list[str] = []
        for skill in self.resolve(skill_ids):
            parts.append(f"### ???{skill.name}?{skill.id}?")
            parts.append(skill.description)
            if skill.workflows:
                parts.append("**???**")
                parts.extend(f"- {w}" for w in skill.workflows)
            for section in skill.prompt_sections:
                parts.append(section.strip())
            if skill.exception_playbooks:
                parts.append("**????**")
                parts.extend(f"- {e}" for e in skill.exception_playbooks)
            if skill.preferred_tools:
                tools = ", ".join(skill.preferred_tools)
                parts.append(f"**????**?{tools}")
            parts.append("")
        return "\n".join(parts).strip()

    def collect_preferred_tools(self, skill_ids: Sequence[str]) -> tuple[str, ...]:
        ordered: list[str] = []
        seen: set[str] = set()
        for skill in self.resolve(skill_ids):
            for tid in skill.preferred_tools:
                if tid not in seen:
                    seen.add(tid)
                    ordered.append(tid)
        return tuple(ordered)

    def list_public(self) -> list[dict[str, Any]]:
        return [
            {
                "id": s.id,
                "name": s.name,
                "description": s.description,
                "preferredTools": list(s.preferred_tools),
            }
            for s in self._skills.values()
        ]


def _catalog() -> list[SkillSpec]:
    from backend.app.agents.skills import (
        base_clarify,
        base_safety,
        base_structure,
        budget_balance,
        critic_pace,
        critic_risk,
        critic_transit,
        local_recommend,
        pitfall_avoid,
        plan_draft,
    )

    return [
        base_clarify.SKILL,
        base_structure.SKILL,
        base_safety.SKILL,
        plan_draft.SKILL,
        budget_balance.SKILL,
        local_recommend.SKILL,
        pitfall_avoid.SKILL,
        critic_pace.SKILL,
        critic_transit.SKILL,
        critic_risk.SKILL,
    ]


@lru_cache
def get_skill_registry() -> SkillRegistry:
    return SkillRegistry(_catalog())


BASE_SKILL_IDS: tuple[str, ...] = (
    "base_clarify",
    "base_structure",
    "base_safety",
)

PLANNER_SKILL_IDS: tuple[str, ...] = (
    *BASE_SKILL_IDS,
    "plan_draft",
    "budget_balance",
)

GUIDE_SKILL_IDS: tuple[str, ...] = (
    *BASE_SKILL_IDS,
    "local_recommend",
    "pitfall_avoid",
)

CRITIC_SKILL_IDS: tuple[str, ...] = (
    *BASE_SKILL_IDS,
    "critic_pace",
    "critic_transit",
    "critic_risk",
)
