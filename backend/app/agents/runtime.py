"""Agent runtime — prompt composition + LangGraph ReAct loop."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Sequence
from typing import TYPE_CHECKING, Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate, SystemMessagePromptTemplate
from langchain_core.tools import BaseTool
from langgraph.prebuilt import create_react_agent

from backend.app.agents.prompts import BASE_GUARDRAILS, ROLE_BY_AGENT_ID
from backend.app.agents.skills import get_skill_registry
from backend.app.agents.tools import get_tool_registry

if TYPE_CHECKING:
    from backend.app.agents.specs import AgentSpec

logger = logging.getLogger(__name__)

_PREVIEW_LIMIT = 32_000


def compose_system_prompt(
    agent_id: str,
    *,
    skill_ids: tuple[str, ...] = (),
    tool_ids: tuple[str, ...] = (),
    role_core: str | None = None,
) -> str:
    """Build a production system prompt from role + skills + tool catalog."""
    role = role_core if role_core is not None else ROLE_BY_AGENT_ID.get(agent_id, "")
    skills_block = ""
    if skill_ids:
        skills_block = get_skill_registry().compose_prompt_block(skill_ids)

    tools_block = ""
    if tool_ids:
        registry = get_tool_registry()
        lines = ["## 可用工具（运行时会按需自动调用）"]
        for tid in tool_ids:
            try:
                spec = registry.get(tid)
            except KeyError:
                continue
            lines.append(f"- `{spec.name}`：{spec.description}")
        tools_block = "\n".join(lines)

    parts = [BASE_GUARDRAILS, role]
    if skills_block:
        parts.append("## 已装备技能\n\n" + skills_block)
    if tools_block:
        parts.append(tools_block)

    system_body = "\n\n".join(p.strip() for p in parts if p and p.strip())
    template = ChatPromptTemplate.from_messages(
        [SystemMessagePromptTemplate.from_template("{system_body}")]
    )
    messages = template.format_messages(system_body=system_body)
    return str(messages[0].content)


def compose_system_prompt_for_agent(agent: AgentSpec) -> str:
    return compose_system_prompt(
        agent.id,
        skill_ids=agent.skill_ids,
        tool_ids=agent.tool_ids,
        role_core=ROLE_BY_AGENT_ID.get(agent.id),
    )


def build_agent(
    *,
    model: BaseChatModel,
    tools: Sequence[BaseTool],
    system_prompt: str,
) -> Any:
    """Create a LangGraph ReAct agent with the composed system prompt."""
    return create_react_agent(model, tools=list(tools), prompt=system_prompt)


def _preview(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, default=str)
        except TypeError:
            text = str(value)
    if len(text) > _PREVIEW_LIMIT:
        return text[:_PREVIEW_LIMIT] + "…"
    return text


def messages_from_chat(
    *,
    system_prompt: str,
    history: Sequence[tuple[str, str]],
) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    if system_prompt.strip():
        messages.append(SystemMessage(content=system_prompt))
    for role, content in history:
        if not content.strip():
            continue
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
        elif role == "system":
            messages.append(SystemMessage(content=content))
    return messages


async def astream_agent(
    agent: Any,
    *,
    input_messages: list[BaseMessage],
) -> AsyncIterator[dict[str, Any]]:
    """
    Yield normalized runtime events for SSE mapping:

    - token / tool_start / tool_result / tool_error
    """
    try:
        async for event in agent.astream_events(
            {"messages": input_messages},
            version="v2",
        ):
            kind = event.get("event")
            name = event.get("name") or ""
            data = event.get("data") or {}

            if kind == "on_chat_model_stream":
                chunk = data.get("chunk")
                text = getattr(chunk, "content", None) if chunk is not None else None
                if isinstance(text, str) and text:
                    yield {"type": "token", "text": text}
                continue

            if kind == "on_tool_start":
                yield {
                    "type": "tool_start",
                    "toolCallId": event.get("run_id") or "",
                    "name": name,
                    "input": data.get("input"),
                }
                continue

            if kind == "on_tool_end":
                output = data.get("output")
                content = getattr(output, "content", output)
                yield {
                    "type": "tool_result",
                    "toolCallId": event.get("run_id") or "",
                    "name": name,
                    "outputPreview": _preview(content),
                }
                continue

            if kind == "on_tool_error":
                err = data.get("error")
                yield {
                    "type": "tool_error",
                    "toolCallId": event.get("run_id") or "",
                    "name": name,
                    "message": str(err) if err else "tool error",
                }
                continue
    except Exception:
        logger.exception("agent stream failed")
        raise
