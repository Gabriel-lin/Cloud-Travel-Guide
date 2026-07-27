"""Builtin / external agent specifications."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from backend.app.agents.skills import (
    CRITIC_SKILL_IDS,
    GUIDE_SKILL_IDS,
    PLANNER_SKILL_IDS,
)
from backend.app.agents.tools import (
    CRITIC_TOOL_IDS,
    GUIDE_TOOL_IDS,
    PLANNER_TOOL_IDS,
)

AgentKind = Literal["builtin", "external"]


@dataclass(frozen=True, slots=True)
class AgentSpec:
    id: str
    kind: AgentKind
    name: str
    description: str
    default_model: str
    """Logical model alias from ``app.llm.registry``."""

    system_prompt: str
    skill_ids: tuple[str, ...] = ()
    tool_ids: tuple[str, ...] = ()
    enabled: bool = True
    status: Literal["ready", "coming_soon"] = "ready"

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "description": self.description,
            "defaultModel": self.default_model,
            "enabled": self.enabled,
            "status": self.status,
        }


def build_builtin_agents() -> list[AgentSpec]:
    from backend.app.agents.runtime import compose_system_prompt

    stubs: list[tuple[str, str, str, str, tuple[str, ...], tuple[str, ...]]] = [
        (
            "travel-planner",
            "行程规划师",
            "根据目的地、天数与预算草拟行程与亮点。",
            "gpt-5.5",
            PLANNER_SKILL_IDS,
            PLANNER_TOOL_IDS,
        ),
        (
            "local-guide",
            "本地向导",
            "推荐美食、交通与避坑经验。",
            "deepseek-v4-pro",
            GUIDE_SKILL_IDS,
            GUIDE_TOOL_IDS,
        ),
        (
            "itinerary-critic",
            "行程审稿人",
            "检查行程节奏、交通衔接与风险点。",
            "opus-4.8",
            CRITIC_SKILL_IDS,
            CRITIC_TOOL_IDS,
        ),
    ]
    agents: list[AgentSpec] = []
    for agent_id, name, description, model, skill_ids, tool_ids in stubs:
        prompt = compose_system_prompt(
            agent_id,
            skill_ids=skill_ids,
            tool_ids=tool_ids,
        )
        agents.append(
            AgentSpec(
                id=agent_id,
                kind="builtin",
                name=name,
                description=description,
                default_model=model,
                system_prompt=prompt,
                skill_ids=skill_ids,
                tool_ids=tool_ids,
            )
        )
    return agents


EXTERNAL_AGENTS: list[AgentSpec] = [
    AgentSpec(
        id="acp-external-expert",
        kind="external",
        name="外界专家（ACP）",
        description="后续按 ACP 协议接入的外部智能体。",
        default_model="gpt-5.5",
        system_prompt="",
        enabled=False,
        status="coming_soon",
    ),
]
