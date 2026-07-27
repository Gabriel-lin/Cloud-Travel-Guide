"""Sandbox image profile resolution tests."""

from __future__ import annotations

import pytest

from backend.app.core.config import get_settings
from backend.sandbox_worker.profiles import (
    normalize_sandbox_profile,
    resolve_sandbox_image,
)


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_normalize_sandbox_profile() -> None:
    assert normalize_sandbox_profile(None) == "default"
    assert normalize_sandbox_profile("playwright") == "playwright"
    with pytest.raises(ValueError, match="profile must be"):
        normalize_sandbox_profile("jupyter")


def test_resolve_sandbox_image_profiles() -> None:
    settings = get_settings()
    assert (
        resolve_sandbox_image(settings, language="python", profile="default")
        == settings.sandbox_python_image
    )
    assert (
        resolve_sandbox_image(settings, language="python", profile="playwright")
        == settings.sandbox_playwright_image
    )
    assert (
        resolve_sandbox_image(settings, language="bash", profile="playwright")
        == settings.sandbox_playwright_image
    )
