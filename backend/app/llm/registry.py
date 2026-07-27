"""Model registry — logical aliases → LiteLLM routes.

- Agents/UI use stable aliases (`gpt-5.5`, `opus-4.8`, `deepseek-v4-pro`)
- Env provides API keys / bases; default alias auto-picks the first configured provider
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from backend.app.core.config import Settings, get_settings


@dataclass(frozen=True, slots=True)
class ModelSpec:
    """One callable model deployment."""

    alias: str
    """Stable id used by agents / API (e.g. ``gpt-5.5``)."""

    litellm_model: str
    """LiteLLM route, e.g. ``openai/gpt-5.5`` or ``anthropic/claude-opus-4-8``."""

    label: str
    provider: str
    """Logical provider family: openai | anthropic | deepseek | openai_compat."""

    api_base: str | None = None
    api_key: str | None = None
    enabled: bool = True
    description: str = ""

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.alias,
            "label": self.label,
            "provider": self.provider,
            "enabled": self.enabled,
            "description": self.description,
            "configured": self.is_configured(),
        }

    def is_configured(self) -> bool:
        if not self.enabled:
            return False
        return bool(self.api_key)


def _default_catalog(settings: Settings) -> list[ModelSpec]:
    """Built-in catalog — aliases stay stable; litellm_model can be remapped via env."""
    openai_key = settings.openai_api_key
    openai_base = settings.openai_api_base
    anthropic_key = settings.anthropic_api_key
    deepseek_key = settings.deepseek_api_key
    deepseek_base = settings.deepseek_api_base
    compat_key = settings.llm_openai_compat_api_key
    compat_base = settings.llm_openai_compat_base_url

    # Prefer dedicated provider keys; fall back to shared OpenAI-compatible gateway.
    def openai_route() -> tuple[str | None, str | None]:
        if openai_key:
            return openai_base, openai_key
        if compat_key and compat_base:
            return compat_base, compat_key
        return openai_base, openai_key

    def anthropic_route() -> tuple[str, str | None, str | None]:
        if anthropic_key:
            return "anthropic/claude-opus-4-8", None, anthropic_key
        if compat_key and compat_base:
            return "openai/opus-4.8", compat_base, compat_key
        return "anthropic/claude-opus-4-8", None, anthropic_key

    def deepseek_route() -> tuple[str, str | None, str | None]:
        # DeepSeek OpenAI-compatible API — pass model id via openai/ prefix + api_base.
        if deepseek_key:
            return (
                "openai/deepseek-v4-pro",
                deepseek_base or "https://api.deepseek.com",
                deepseek_key,
            )
        if compat_key and compat_base:
            return "openai/deepseek-v4-pro", compat_base, compat_key
        return (
            "openai/deepseek-v4-pro",
            deepseek_base or "https://api.deepseek.com",
            deepseek_key,
        )

    gpt_base, gpt_key = openai_route()
    claude_model, claude_base, claude_key = anthropic_route()
    ds_model, ds_base, ds_key = deepseek_route()

    return [
        ModelSpec(
            alias="gpt-5.5",
            litellm_model="openai/gpt-5.5",
            label="GPT-5.5",
            provider="openai" if openai_key else ("openai_compat" if compat_key else "openai"),
            api_base=gpt_base,
            api_key=gpt_key,
            description="OpenAI GPT family (or OpenAI-compatible gateway)",
        ),
        ModelSpec(
            alias="opus-4.8",
            litellm_model=claude_model,
            label="Opus 4.8",
            provider="anthropic"
            if anthropic_key
            else ("openai_compat" if compat_key else "anthropic"),
            api_base=claude_base,
            api_key=claude_key,
            description="Anthropic Claude Opus (native or via compatible gateway)",
        ),
        ModelSpec(
            alias="deepseek-v4-pro",
            litellm_model=ds_model,
            label="DeepSeek V4 Pro",
            provider="deepseek"
            if deepseek_key
            else ("openai_compat" if compat_key else "deepseek"),
            api_base=ds_base,
            api_key=ds_key,
            description="DeepSeek V4 Pro",
        ),
    ]


def _provider_priority_aliases(settings: Settings) -> list[str]:
    """Ordered aliases to prefer as default based on which env keys are set."""
    aliases: list[str] = []
    if settings.openai_api_key and settings.openai_api_base:
        aliases.append("gpt-5.5")
    if settings.anthropic_api_key:
        aliases.append("opus-4.8")
    if settings.deepseek_api_key and settings.deepseek_api_base:
        aliases.append("deepseek-v4-pro")
    # OpenAI key without base still counts (official API)
    if settings.openai_api_key and "gpt-5.5" not in aliases:
        aliases.insert(0, "gpt-5.5")
    if settings.llm_openai_compat_api_key and settings.llm_openai_compat_base_url and not aliases:
        aliases.extend(["gpt-5.5", "opus-4.8", "deepseek-v4-pro"])
    return aliases


def resolve_default_alias(settings: Settings, catalog: list[ModelSpec]) -> str:
    """Pick default model: honor LLM_DEFAULT_MODEL when configured, else first ready provider."""
    by_alias = {m.alias: m for m in catalog}
    configured = {m.alias for m in catalog if m.is_configured()}

    preferred = settings.llm_default_model
    if preferred in configured:
        return preferred

    for alias in _provider_priority_aliases(settings):
        if alias in configured:
            return alias

    if preferred in by_alias:
        return preferred
    return catalog[0].alias


def _parse_alias_overrides(raw: str | None) -> dict[str, str]:
    """JSON map: alias → litellm model string."""
    if not raw or not raw.strip():
        return {}
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("LLM_MODEL_ALIASES must be a JSON object")
    return {str(k): str(v) for k, v in data.items()}


class ModelRegistry:
    def __init__(self, models: list[ModelSpec], default_alias: str) -> None:
        self._models = {m.alias: m for m in models}
        self.default_alias = default_alias if default_alias in self._models else models[0].alias

    def get(self, alias: str | None) -> ModelSpec:
        key = alias or self.default_alias
        if key not in self._models:
            raise KeyError(f"Unknown model alias: {key}")
        return self._models[key]

    def resolve(self, preferred: str | None = None) -> ModelSpec:
        """Return a configured model: preferred if ready, else registry default."""
        if preferred:
            try:
                spec = self.get(preferred)
                if spec.is_configured():
                    return spec
            except KeyError:
                pass
        return self.get(self.default_alias)

    def list_public(self) -> list[dict[str, Any]]:
        return [m.to_public_dict() for m in self._models.values()]

    def any_configured(self) -> bool:
        return any(m.is_configured() for m in self._models.values())


@lru_cache
def get_model_registry() -> ModelRegistry:
    settings = get_settings()
    catalog = _default_catalog(settings)
    overrides = _parse_alias_overrides(settings.llm_model_aliases)
    if overrides:
        remapped: list[ModelSpec] = []
        for spec in catalog:
            litellm_model = overrides.get(spec.alias, spec.litellm_model)
            remapped.append(
                ModelSpec(
                    alias=spec.alias,
                    litellm_model=litellm_model,
                    label=spec.label,
                    provider=spec.provider,
                    api_base=spec.api_base,
                    api_key=spec.api_key,
                    enabled=spec.enabled,
                    description=spec.description,
                )
            )
        catalog = remapped
    default_alias = resolve_default_alias(settings, catalog)
    return ModelRegistry(catalog, default_alias)
