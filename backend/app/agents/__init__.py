"""Agent registry — builtin experts now, external ACP later."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from backend.app.agents.specs import (
    EXTERNAL_AGENTS,
    AgentKind,
    AgentSpec,
    build_builtin_agents,
)

__all__ = [
    "EXTERNAL_AGENTS",
    "AgentKind",
    "AgentRegistry",
    "AgentSpec",
    "get_agent_registry",
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
    return AgentRegistry([*build_builtin_agents(), *EXTERNAL_AGENTS])
