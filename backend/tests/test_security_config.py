import pytest
from pydantic import ValidationError

from backend.app.core.config import DEFAULT_SECRET_KEY, Settings, get_settings
from backend.app.core.exceptions import BadRequestError
from backend.app.services.oauth_service import OAuthService


def test_oauth_authorize_url_forces_account_selection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GITHUB_CLIENT_ID", "github-client-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "github-client-secret")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "google-client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "google-client-secret")
    get_settings.cache_clear()
    try:
        service = OAuthService.__new__(OAuthService)
        github_url = service.build_authorize_url("github", "http://127.0.0.1:3000/auth/callback")
        google_url = service.build_authorize_url("google", "http://127.0.0.1:3000/auth/callback")
    finally:
        get_settings.cache_clear()

    assert "prompt=select_account" in github_url
    assert "prompt=select_account+consent" in google_url


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
            AUTH_COOKIE_SECURE=True,
            CORS_ORIGINS="*",
        )


def test_production_requires_secure_auth_cookie() -> None:
    with pytest.raises(ValidationError, match="AUTH_COOKIE_SECURE"):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY="test-secret-key-with-at-least-32-bytes",
            AUTH_COOKIE_SECURE=False,
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
