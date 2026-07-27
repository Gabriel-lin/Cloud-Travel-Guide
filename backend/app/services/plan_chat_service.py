"""Plan chat service — LangGraph agent loop + SSE event stream."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy.orm import Session

from backend.app.agents import AgentRegistry, AgentSpec, get_agent_registry
from backend.app.agents.context import AgentRunContext, clear_agent_context, set_agent_context
from backend.app.agents.runtime import astream_agent, build_agent, messages_from_chat
from backend.app.agents.tools import get_tool_registry
from backend.app.core.exceptions import AppError
from backend.app.llm.langchain_model import build_chat_model
from backend.app.llm.registry import ModelRegistry, get_model_registry
from backend.app.models.user import User
from backend.app.schemas.plan import PlanChatRequest
from backend.app.services.plan_service import PlanService

logger = logging.getLogger(__name__)


class PlanChatService:
    def __init__(
        self,
        agents: AgentRegistry | None = None,
        models: ModelRegistry | None = None,
    ) -> None:
        self.agents = agents or get_agent_registry()
        self.models = models or get_model_registry()

    def list_catalog(self) -> dict[str, Any]:
        default = self.agents.default_agent()
        return {
            "agents": self.agents.list_public(),
            "models": self.models.list_public(),
            "defaultAgentId": default.id,
            "defaultModelId": self.models.default_alias,
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

    async def stream_chat(
        self,
        request: PlanChatRequest,
        *,
        user: User,
        db: Session,
    ) -> AsyncIterator[str]:
        """Yield SSE `data:` lines (JSON payloads)."""
        agent = self.resolve_agent(request.agent_id)
        model_spec = self.models.resolve(request.model or agent.default_model)
        model_alias = model_spec.alias

        plan_id: uuid.UUID | None = None
        if request.plan_id:
            # Ownership check — Plan tools bind to this id
            PlanService(db).get_plan(user, request.plan_id)
            plan_id = request.plan_id

        progress_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        async def on_progress(payload: dict[str, Any]) -> None:
            await progress_queue.put(payload)

        set_agent_context(
            AgentRunContext(
                user_id=user.id,
                plan_id=plan_id,
                thread_id=request.thread_id,
                agent_id=agent.id,
                db=db,
                on_progress=on_progress,
            )
        )

        yield self._sse(
            {
                "type": "start",
                "agentId": agent.id,
                "model": model_alias,
                "threadId": request.thread_id,
                "planId": str(plan_id) if plan_id else None,
            }
        )

        try:
            chat_model = build_chat_model(model_alias)
            tools = get_tool_registry().resolve(agent.tool_ids)
            graph = build_agent(
                model=chat_model,
                tools=tools,
                system_prompt=agent.system_prompt,
            )
            history = [
                (m.role, m.content)
                for m in request.messages
                if m.role in {"user", "assistant"} and m.content.strip()
            ]
            # System prompt is applied via create_react_agent(prompt=...)
            input_messages = messages_from_chat(system_prompt="", history=history)
            # Drop empty system placeholder
            input_messages = [m for m in input_messages if getattr(m, "content", None)]

            async for event in astream_agent(graph, input_messages=input_messages):
                # Drain progress events first
                while not progress_queue.empty():
                    prog = progress_queue.get_nowait()
                    yield self._sse(prog)

                etype = event.get("type")
                if etype == "token":
                    yield self._sse({"type": "delta", "text": event.get("text", "")})
                elif etype == "tool_start":
                    yield self._sse(
                        {
                            "type": "tool_start",
                            "toolCallId": event.get("toolCallId"),
                            "name": event.get("name"),
                            "input": event.get("input"),
                        }
                    )
                elif etype == "tool_result":
                    yield self._sse(
                        {
                            "type": "tool_result",
                            "toolCallId": event.get("toolCallId"),
                            "name": event.get("name"),
                            "outputPreview": event.get("outputPreview"),
                        }
                    )
                elif etype == "tool_error":
                    yield self._sse(
                        {
                            "type": "tool_error",
                            "toolCallId": event.get("toolCallId"),
                            "name": event.get("name"),
                            "message": event.get("message"),
                        }
                    )

            while not progress_queue.empty():
                yield self._sse(progress_queue.get_nowait())

        except Exception as exc:
            logger.exception("plan chat stream failed")
            yield self._sse({"type": "error", "message": str(exc)})
            yield self._sse({"type": "done"})
            return
        finally:
            clear_agent_context()

        yield self._sse({"type": "done"})

    @staticmethod
    def _sse(payload: dict[str, Any]) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
