"""Sandbox image profile resolution."""

from __future__ import annotations

from typing import Literal

from backend.app.core.config import Settings

SandboxProfile = Literal["default", "playwright"]

_VALID_PROFILES = frozenset({"default", "playwright"})


def normalize_sandbox_profile(raw: str | None) -> SandboxProfile:
    profile = (raw or "default").strip().lower()
    if profile not in _VALID_PROFILES:
        raise ValueError(f"profile must be one of: {', '.join(sorted(_VALID_PROFILES))}")
    return profile  # type: ignore[return-value]


def resolve_sandbox_image(
    settings: Settings,
    *,
    language: str,
    profile: str | None = None,
) -> str:
    """Map job language + profile to a pre-built Docker image tag."""
    normalized = normalize_sandbox_profile(profile)
    if normalized == "playwright":
        return settings.sandbox_playwright_image
    if language == "bash":
        return settings.sandbox_bash_image
    return settings.sandbox_python_image


def list_sandbox_images(settings: Settings) -> set[str]:
    return {
        settings.sandbox_python_image,
        settings.sandbox_bash_image,
        settings.sandbox_playwright_image,
    }
