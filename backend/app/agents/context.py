"""Runtime context for agent tools (user, plan, job progress bridge)."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None] | None]


@dataclass(slots=True)
class AgentRunContext:
    user_id: uuid.UUID | None = None
    plan_id: uuid.UUID | None = None
    thread_id: str | None = None
    agent_id: str | None = None
    # Injected DB session factory / session for plan tools (sync Session)
    db: Any = None
    on_progress: ProgressCallback | None = None
    extras: dict[str, Any] = field(default_factory=dict)


_agent_context: ContextVar[AgentRunContext | None] = ContextVar("agent_run_context", default=None)


def set_agent_context(ctx: AgentRunContext) -> None:
    _agent_context.set(ctx)


def get_agent_context() -> AgentRunContext:
    ctx = _agent_context.get()
    if ctx is None:
        return AgentRunContext()
    return ctx


def clear_agent_context() -> None:
    _agent_context.set(None)


async def emit_progress(payload: dict[str, Any]) -> None:
    ctx = get_agent_context()
    if ctx.on_progress is None:
        return
    result = ctx.on_progress(payload)
    if result is not None:
        await result
