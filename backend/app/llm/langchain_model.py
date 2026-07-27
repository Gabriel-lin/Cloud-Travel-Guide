"""LiteLLM-backed LangChain ChatModel (+ mock for local/dev)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Iterator, Sequence
from typing import Any

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from pydantic import Field

from backend.app.core.config import get_settings
from backend.app.llm.registry import ModelSpec, get_model_registry

logger = logging.getLogger(__name__)


def _is_retryable_llm_error(exc: Exception) -> bool:
    name = type(exc).__name__.lower()
    if any(token in name for token in ("connection", "timeout", "ssl", "apierror")):
        return True
    message = str(exc).lower()
    return any(
        token in message
        for token in ("connection error", "ssl", "timed out", "timeout", "record layer failure")
    )


def _message_to_openai(msg: BaseMessage) -> dict[str, Any]:
    if isinstance(msg, SystemMessage):
        return {"role": "system", "content": str(msg.content)}
    if isinstance(msg, HumanMessage):
        return {"role": "user", "content": str(msg.content)}
    if isinstance(msg, ToolMessage):
        return {
            "role": "tool",
            "content": str(msg.content),
            "tool_call_id": msg.tool_call_id,
        }
    if isinstance(msg, AIMessage):
        payload: dict[str, Any] = {"role": "assistant", "content": str(msg.content or "")}
        tool_calls = getattr(msg, "tool_calls", None) or []
        if tool_calls:
            payload["tool_calls"] = [
                {
                    "id": tc.get("id") or tc.get("id", f"call_{i}"),
                    "type": "function",
                    "function": {
                        "name": tc.get("name"),
                        "arguments": tc.get("args")
                        if isinstance(tc.get("args"), str)
                        else json.dumps(tc.get("args") or {}, ensure_ascii=False),
                    },
                }
                for i, tc in enumerate(tool_calls)
            ]
        return payload
    return {"role": "user", "content": str(msg.content)}


class MockTravelChatModel(BaseChatModel):
    """Deterministic reply when no API key is configured."""

    model_alias: str = "mock"

    @property
    def _llm_type(self) -> str:
        return "mock-travel-chat"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        user = ""
        for msg in reversed(messages):
            if isinstance(msg, HumanMessage):
                user = str(msg.content)
                break
        preview = (user[:80] + "…") if len(user) > 80 else user
        text = (
            f"（模拟回复 · 模型别名 `{self.model_alias}`）\n\n"
            "当前未配置可用的 API Key，因此返回本地 mock 内容（未调用工具）。\n\n"
            f"你刚才说：{preview or '（空消息）'}"
        )
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text))])

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        return self._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        result = self._generate(messages, stop=stop, run_manager=run_manager, **kwargs)
        text = str(result.generations[0].message.content)
        for i in range(0, len(text), 24):
            yield ChatGenerationChunk(message=AIMessageChunk(content=text[i : i + 24]))

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        for chunk in self._stream(messages, stop=stop, run_manager=run_manager, **kwargs):
            yield chunk


class LiteLLMChatModel(BaseChatModel):
    """Thin LiteLLM wrapper that honors ModelSpec routing."""

    model_alias: str
    litellm_model: str
    api_key: str | None = None
    api_base: str | None = None
    temperature: float = 0.7
    bound_tools: list[dict[str, Any]] = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "litellm-travel-chat"

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> LiteLLMChatModel:
        from langchain_core.utils.function_calling import convert_to_openai_tool

        openai_tools = [convert_to_openai_tool(t) for t in tools]
        return self.model_copy(update={"bound_tools": openai_tools})

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        import asyncio
        import concurrent.futures

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(
                self._agenerate(messages, stop=stop, run_manager=run_manager, **kwargs)
            )

        # Sync path called from a running loop — run coroutine on a worker thread.
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(
                asyncio.run,
                self._agenerate(messages, stop=stop, run_manager=run_manager, **kwargs),
            ).result()

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        import asyncio

        from litellm import acompletion

        params: dict[str, Any] = {
            "model": self.litellm_model,
            "messages": [_message_to_openai(m) for m in messages],
            "temperature": self.temperature,
            "stream": False,
            "timeout": 120,
            "num_retries": 2,
        }
        if self.api_key:
            params["api_key"] = self.api_key
        if self.api_base:
            params["api_base"] = self.api_base
        if self.bound_tools:
            params["tools"] = self.bound_tools
            params["tool_choice"] = "auto"
        if stop:
            params["stop"] = stop

        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                response = await acompletion(**params)
                break
            except Exception as exc:
                last_exc = exc
                if attempt >= 2 or not _is_retryable_llm_error(exc):
                    raise
                delay = 1.5 * (2**attempt)
                logger.warning(
                    "LLM request failed (attempt %s/3), retrying in %.1fs: %s",
                    attempt + 1,
                    delay,
                    exc,
                )
                await asyncio.sleep(delay)
        else:
            assert last_exc is not None
            raise last_exc

        choice = response.choices[0]
        message = choice.message
        content = getattr(message, "content", None) or ""
        tool_calls_raw = getattr(message, "tool_calls", None) or []
        tool_calls: list[dict[str, Any]] = []
        for tc in tool_calls_raw:
            fn = getattr(tc, "function", None) or tc.get("function", {})
            name = getattr(fn, "name", None) if not isinstance(fn, dict) else fn.get("name")
            args_raw = (
                getattr(fn, "arguments", None) if not isinstance(fn, dict) else fn.get("arguments")
            )
            try:
                args = json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
            except json.JSONDecodeError:
                args = {"_raw": args_raw}
            tool_calls.append(
                {
                    "name": name,
                    "args": args,
                    "id": getattr(tc, "id", None)
                    or (tc.get("id") if isinstance(tc, dict) else None),
                    "type": "tool_call",
                }
            )
        ai = AIMessage(content=content, tool_calls=tool_calls)
        return ChatResult(generations=[ChatGeneration(message=ai)])

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        # For tool-calling agents, prefer non-stream complete then yield content chunks.
        # Streaming tool_calls via LiteLLM deltas is provider-dependent; this keeps behavior stable.
        result = await self._agenerate(messages, stop=stop, run_manager=run_manager, **kwargs)
        message = result.generations[0].message
        assert isinstance(message, AIMessage)
        if message.tool_calls:
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content=str(message.content or ""),
                    tool_calls=message.tool_calls,
                )
            )
            return
        text = str(message.content or "")
        for i in range(0, max(len(text), 1), 32):
            yield ChatGenerationChunk(message=AIMessageChunk(content=text[i : i + 32]))


def build_chat_model(model_alias: str | None = None) -> BaseChatModel:
    registry = get_model_registry()
    settings = get_settings()
    try:
        spec: ModelSpec = registry.get(model_alias)
    except KeyError:
        spec = registry.get(registry.default_alias)

    if not spec.is_configured():
        if settings.llm_allow_mock:
            return MockTravelChatModel(model_alias=spec.alias)
        raise RuntimeError(
            f"Model '{spec.alias}' is not configured. "
            "Set provider API keys or LLM_OPENAI_COMPAT_* in .env."
        )

    return LiteLLMChatModel(
        model_alias=spec.alias,
        litellm_model=spec.litellm_model,
        api_key=spec.api_key,
        api_base=spec.api_base,
    )
