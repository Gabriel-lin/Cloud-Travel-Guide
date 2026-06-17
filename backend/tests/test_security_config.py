import pytest
from pydantic import ValidationError

from backend.app.core.config import DEFAULT_SECRET_KEY, Settings, get_settings
from backend.app.core.exceptions import BadRequestError
from backend.app.services.oauth_service import OAuthService


def test_production_rejects_default_secret() -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY=DEFAULT_SECRET_KEY,
        )


def test_production_rejects_wildcard_origins() -> None:
    with pytest.raises(ValidationError, match="Wildcard origins"):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY="test-secret-key-with-at-least-32-bytes",
            CORS_ORIGINS="*",
        )


def test_oauth_redirect_uri_must_match_allowed_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OAUTH_REDIRECT_ORIGINS", "http://allowed.test")
    get_settings.cache_clear()
    try:
        assert (
            OAuthService._validate_redirect_uri("http://allowed.test/auth/callback")
            == "http://allowed.test/auth/callback"
        )
        with pytest.raises(BadRequestError, match="origin is not allowed"):
            OAuthService._validate_redirect_uri("http://evil.test/auth/callback")
    finally:
        get_settings.cache_clear()
