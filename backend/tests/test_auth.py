"""Authentication API tests."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Must be set before importing the app so settings/engine use the test database.
os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-secret-key-with-at-least-32-bytes"

from backend.app.core.config import AUTH_COOKIE_NAME
from backend.app.core.database import Base, get_db
from backend.app.core.exceptions import BadRequestError
from backend.app.main import create_app
from backend.app.models.oauth_account import OAuthAccount
from backend.app.services.auth_service import AuthService
from backend.app.services.oauth_service import OAuthService
from backend.tests.auth_transport import login_user, register_user, seal_password_for_request


@pytest.fixture
def client() -> TestClient:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    app = create_app()

    def override_get_db():
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def test_health(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_password_key_endpoint(client: TestClient) -> None:
    response = client.get("/api/v1/auth/password-key")
    assert response.status_code == 200
    payload = response.json()
    assert payload["algorithm"] == "RSA-OAEP-256"
    assert payload["cipher_suite"] == "AES-GCM"
    assert payload["public_key"].startswith("-----BEGIN PUBLIC KEY-----")


def test_register_login_me_logout_flow(client: TestClient) -> None:
    register_user(client, username="traveler", password="Secret123")
    token_payload = login_user(client, username="traveler", password="Secret123")
    assert token_payload["token_type"] == "bearer"
    assert token_payload["access_token"]

    me = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token_payload['access_token']}"},
    )
    assert me.status_code == 200
    user = me.json()
    assert user["username"] == "traveler"
    assert user["displayName"] == "traveler"
    assert user["provider"] == "local"

    logout = client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {token_payload['access_token']}"},
    )
    assert logout.status_code == 200

    me_after_logout = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token_payload['access_token']}"},
    )
    assert me_after_logout.status_code == 401


def test_current_user_accepts_auth_cookie(client: TestClient) -> None:
    register_user(client, username="cookie_user", password="Secret123")
    token_payload = login_user(client, username="cookie_user", password="Secret123")

    client.cookies.set(AUTH_COOKIE_NAME, token_payload["access_token"])
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "cookie_user"

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 200

    me_after_logout = client.get("/api/v1/auth/me")
    assert me_after_logout.status_code == 401


def test_login_rejects_replayed_password_envelope(client: TestClient) -> None:
    register_user(client, username="replay_user", password="Secret123")
    envelope = seal_password_for_request(client, "Secret123")

    first = client.post(
        "/api/v1/auth/login",
        json={"username": "replay_user", "password_envelope": envelope},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/v1/auth/login",
        json={"username": "replay_user", "password_envelope": envelope},
    )
    assert second.status_code == 400
    assert second.json()["detail"] == "Password envelope has already been used"


def test_logout_revokes_oauth_authorization_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    db = testing_session_local()
    revoked: list[tuple[str, str | None]] = []

    def fake_revoke_provider_token(_: AuthService, account: OAuthAccount) -> None:
        revoked.append((account.provider, account.access_token))

    monkeypatch.setattr(AuthService, "_revoke_provider_token", fake_revoke_provider_token)

    try:
        auth_service = AuthService(db)
        user = auth_service.register(username="oauth_user", password="Secret123")
        account = OAuthAccount(
            user_id=user.id,
            provider="github",
            provider_user_id="github-123",
            access_token="github-access-token",
            refresh_token="github-refresh-token",
        )
        db.add(account)
        db.commit()

        token = auth_service.issue_token(user).access_token
        auth_service.logout(token)

        db.refresh(account)
        assert revoked == [("github", "github-access-token")]
        assert account.access_token is None
        assert account.refresh_token is None
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


def test_desktop_oauth_code_is_single_use() -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    db = testing_session_local()

    try:
        auth_service = AuthService(db)
        oauth_service = OAuthService(db)
        user = auth_service.register(username="desktop_user", password="Secret123")

        code = oauth_service._create_desktop_login_code(user)
        token = oauth_service.exchange_desktop_code(code)
        assert token.access_token

        with pytest.raises(BadRequestError, match="invalid"):
            oauth_service.exchange_desktop_code(code)
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


def test_frontend_oauth_redirect_includes_login_code() -> None:
    redirect = OAuthService._build_frontend_redirect(
        "http://127.0.0.1:3000/auth/callback",
        "one-time-login-code",
    )
    assert redirect.startswith("http://127.0.0.1:3000/auth/callback?")
    assert "code=one-time-login-code" in redirect
    assert "oauth=success" not in redirect


def test_login_rejects_unregistered_user(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "username": "ghost",
            "password_envelope": seal_password_for_request(client, "Secret123"),
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "User is not registered"


def test_login_rejects_incorrect_password(client: TestClient) -> None:
    register_user(client, username="traveler", password="Secret123")
    response = client.post(
        "/api/v1/auth/login",
        json={
            "username": "traveler",
            "password_envelope": seal_password_for_request(client, "WrongPass1"),
        },
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect password"


def test_register_rejects_duplicate_username(client: TestClient) -> None:
    register_user(client, username="duplicate", password="Secret123")
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": "duplicate",
            "password_envelope": seal_password_for_request(client, "Secret123"),
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Username already exists"


def test_register_validates_payload(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": "ab",
            "password_envelope": seal_password_for_request(client, "12345"),
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "password",
    [
        "Aa1",
        "noupper123",
        "NOLOWER123",
        "NoDigits",
        "Bad-Pass1",
    ],
)
def test_register_rejects_invalid_password(client: TestClient, password: str) -> None:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": "valid_user",
            "password_envelope": seal_password_for_request(client, password),
        },
    )
    assert response.status_code == 400


def test_openapi_available(client: TestClient) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert "openapi" in response.json()
