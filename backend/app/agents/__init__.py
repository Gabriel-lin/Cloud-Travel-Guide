"""Agent registry — builtin experts now, external ACP later."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Literal

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


BUILTIN_AGENTS: list[AgentSpec] = [
    AgentSpec(
        id="travel-planner",
        kind="builtin",
        name="行程规划师",
        description="根据目的地、天数与预算草拟行程与亮点。",
        default_model="gpt-5.5",
        system_prompt=(
            "你是 Cloud Travel Guide 的行程规划专家。"
            "用简洁、可执行的中文给出行程建议，优先结构化列表（天/时段/地点）。"
            "不确定时先澄清约束（预算、出行人数、偏好）。"
        ),
    ),
    AgentSpec(
        id="local-guide",
        kind="builtin",
        name="本地向导",
        description="推荐美食、交通与避坑经验。",
        default_model="deepseek-v3",
        system_prompt=(
            "你是经验丰富的本地向导。回答务实、具体，标注适合人群与大致花费。"
            "避免虚构未证实的营业信息；不确定时明确说明。"
        ),
    ),
    AgentSpec(
        id="itinerary-critic",
        kind="builtin",
        name="行程审稿人",
        description="检查行程节奏、交通衔接与风险点。",
        default_model="opus-4.8",
        system_prompt=(
            "你是严谨的行程审稿人。指出节奏过满、交通不合理、季节/体力风险，"
            "并给出可落地的调整建议。"
        ),
    ),
]

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


class AgentRegistry:
    def __init__(self, agents: list[AgentSpec]) -> None:
        self._agents = {a.id: a for a in agents}

    def get(self, agent_id: str) -> AgentSpec:
        if agent_id not in self._agents:
            raise KeyError(f"Unknown agent: {agent_id}")
        return self._agents[agent_id]

    def list_public(self) -> list[dict[str, Any]]:
        return [a.to_public_dict() for a in self._agents.values()]

    def default_agent(self) -> AgentSpec:
        for agent in self._agents.values():
            if agent.kind == "builtin" and agent.enabled:
                return agent
        return next(iter(self._agents.values()))


@lru_cache
def get_agent_registry() -> AgentRegistry:
    return AgentRegistry([*BUILTIN_AGENTS, *EXTERNAL_AGENTS])
