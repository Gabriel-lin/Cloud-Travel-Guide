"""LiteLLM-backed streaming chat router with mock fallback."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from backend.app.core.config import get_settings
from backend.app.llm.registry import ModelSpec, get_model_registry

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ChatMessage:
    role: str
    content: str


class LLMRouter:
    """Unified streaming entry — agents call this, never provider SDKs directly."""

    async def stream_chat(
        self,
        *,
        messages: list[ChatMessage],
        model_alias: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        registry = get_model_registry()
        settings = get_settings()
        try:
            spec = registry.get(model_alias)
        except KeyError:
            spec = registry.get(registry.default_alias)

        if not spec.is_configured():
            if settings.llm_allow_mock:
                async for chunk in self._mock_stream(messages, spec):
                    yield chunk
                return
            raise RuntimeError(
                f"Model '{spec.alias}' is not configured. "
                "Set provider API keys or LLM_OPENAI_COMPAT_* in .env."
            )

        async for chunk in self._litellm_stream(
            messages=messages,
            spec=spec,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            yield chunk

    async def _litellm_stream(
        self,
        *,
        messages: list[ChatMessage],
        spec: ModelSpec,
        temperature: float,
        max_tokens: int | None,
    ) -> AsyncIterator[str]:
        # Import lazily so app boot stays light when LLM unused
        from litellm import acompletion

        kwargs: dict[str, Any] = {
            "model": spec.litellm_model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "temperature": temperature,
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        if spec.api_key:
            kwargs["api_key"] = spec.api_key
        if spec.api_base:
            kwargs["api_base"] = spec.api_base

        try:
            response = await acompletion(**kwargs)
        except Exception:
            logger.exception("LiteLLM completion failed for model=%s", spec.alias)
            raise

        async for chunk in response:
            try:
                delta = chunk.choices[0].delta
                text = getattr(delta, "content", None) or ""
            except (AttributeError, IndexError, KeyError, TypeError):
                text = ""
            if text:
                yield text

    async def _mock_stream(
        self,
        messages: list[ChatMessage],
        spec: ModelSpec,
    ) -> AsyncIterator[str]:
        user = next((m.content for m in reversed(messages) if m.role == "user"), "")
        preview = (user[:80] + "…") if len(user) > 80 else user
        parts = [
            f"（模拟回复 · 模型别名 `{spec.alias}`）\n\n",
            "当前未配置可用的 API Key，因此返回本地 mock 流式内容。\n\n",
            "配置示例：\n",
            "- 官方：`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY`\n",
            "- 三方网关：`LLM_OPENAI_COMPAT_BASE_URL` + `LLM_OPENAI_COMPAT_API_KEY`\n\n",
            f"你刚才说：{preview or '（空消息）'}\n\n",
            "配置完成后即可切换到真实的 GPT / Claude / DeepSeek 等模型。",
        ]
        for part in parts:
            yield part
            await asyncio.sleep(0.03)


@lru_cache
def get_llm_router() -> LLMRouter:
    return LLMRouter()
