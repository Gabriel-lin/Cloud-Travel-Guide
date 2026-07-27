"""Tests for skill registry and system prompt composition."""

from __future__ import annotations

from backend.app.agents import get_agent_registry
from backend.app.agents.runtime import compose_system_prompt
from backend.app.agents.skills import (
    PLANNER_SKILL_IDS,
    get_skill_registry,
)
from backend.app.agents.tools import PLANNER_TOOL_IDS


def test_skill_registry_contains_base_and_specialized():
    registry = get_skill_registry()
    for sid in (
        "base_clarify",
        "plan_draft",
        "local_recommend",
        "critic_pace",
    ):
        skill = registry.get(sid)
        assert skill.id == sid
        assert skill.prompt_sections


def test_compose_prompt_includes_role_skills_tools():
    prompt = compose_system_prompt(
        "travel-planner",
        skill_ids=PLANNER_SKILL_IDS,
        tool_ids=PLANNER_TOOL_IDS,
    )
    assert "行程规划师" in prompt
    assert "plan_draft" in prompt
    assert "web_search" in prompt
    assert "全局护栏" in prompt


def test_builtin_agents_have_rich_prompts():
    # Clear cache so composition runs with current modules
    get_agent_registry.cache_clear()
    registry = get_agent_registry()
    for agent_id in ("travel-planner", "local-guide", "itinerary-critic"):
        agent = registry.get(agent_id)
        assert agent.kind == "builtin"
        assert len(agent.system_prompt) > 500
        assert agent.skill_ids
        assert agent.tool_ids
        assert "异常" in agent.system_prompt or "异常处理" in agent.system_prompt
