"""Multi-provider LLM layer (LiteLLM router + model registry)."""

from backend.app.llm.registry import ModelSpec, get_model_registry
from backend.app.llm.router import LLMRouter, get_llm_router

__all__ = [
    "LLMRouter",
    "ModelSpec",
    "get_llm_router",
    "get_model_registry",
]
