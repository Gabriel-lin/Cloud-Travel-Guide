"""Plan chat service — agent resolution + SSE token stream."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from backend.app.agents import AgentRegistry, AgentSpec, get_agent_registry
from backend.app.core.exceptions import AppError
from backend.app.llm.registry import ModelRegistry, get_model_registry
from backend.app.llm.router import ChatMessage, LLMRouter, get_llm_router
from backend.app.schemas.plan import PlanChatRequest

logger = logging.getLogger(__name__)


class PlanChatService:
    def __init__(
        self,
        agents: AgentRegistry | None = None,
        models: ModelRegistry | None = None,
        llm: LLMRouter | None = None,
    ) -> None:
        self.agents = agents or get_agent_registry()
        self.models = models or get_model_registry()
        self.llm = llm or get_llm_router()

    def list_catalog(self) -> dict[str, Any]:
        default = self.agents.default_agent()
        return {
            "agents": self.agents.list_public(),
            "models": self.models.list_public(),
            "defaultAgentId": default.id,
        }

    def resolve_agent(self, agent_id: str) -> AgentSpec:
        try:
            agent = self.agents.get(agent_id)
        except KeyError as exc:
            raise AppError(
                f"Unknown agent: {agent_id}",
                status_code=404,
                code="agent_not_found",
            ) from exc

        if agent.kind == "external" or agent.status != "ready" or not agent.enabled:
            raise AppError(
                "该智能体尚未接入（外界专家将按 ACP 协议接入）",
                status_code=400,
                code="agent_unavailable",
            )
        return agent

    async def stream_chat(self, request: PlanChatRequest) -> AsyncIterator[str]:
        """Yield SSE `data:` lines (JSON payloads)."""
        agent = self.resolve_agent(request.agent_id)

        model_alias = request.model or agent.default_model
        chat_messages: list[ChatMessage] = [
            ChatMessage(role="system", content=agent.system_prompt),
        ]
        for msg in request.messages:
            if msg.role in {"user", "assistant", "system"} and msg.content.strip():
                chat_messages.append(ChatMessage(role=msg.role, content=msg.content))

        yield self._sse(
            {
                "type": "start",
                "agentId": agent.id,
                "model": model_alias,
                "threadId": request.thread_id,
            }
        )

        try:
            async for token in self.llm.stream_chat(
                messages=chat_messages,
                model_alias=model_alias,
            ):
                yield self._sse({"type": "delta", "text": token})
        except Exception as exc:
            logger.exception("plan chat stream failed")
            yield self._sse({"type": "error", "message": str(exc)})
            yield self._sse({"type": "done"})
            return

        yield self._sse({"type": "done"})

    @staticmethod
    def _sse(payload: dict[str, Any]) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
