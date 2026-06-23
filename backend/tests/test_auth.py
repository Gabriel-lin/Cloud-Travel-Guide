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


def test_register_login_me_logout_flow(client: TestClient) -> None:
    register = client.post(
        "/api/v1/auth/register",
        params={"username": "traveler", "password": "secret123"},
    )
    assert register.status_code == 201
    assert register.json()["message"] == "User registered successfully"

    login = client.post(
        "/api/v1/auth/token",
        data={"username": "traveler", "password": "secret123"},
    )
    assert login.status_code == 200
    token_payload = login.json()
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
    register = client.post(
        "/api/v1/auth/register",
        params={"username": "cookie_user", "password": "secret123"},
    )
    assert register.status_code == 201

    login = client.post(
        "/api/v1/auth/token",
        data={"username": "cookie_user", "password": "secret123"},
    )
    assert login.status_code == 200
    token_payload = login.json()

    client.cookies.set(AUTH_COOKIE_NAME, token_payload["access_token"])
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "cookie_user"

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 200

    me_after_logout = client.get("/api/v1/auth/me")
    assert me_after_logout.status_code == 401


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
        user = auth_service.register(username="oauth_user", password="secret123")
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
        user = auth_service.register(username="desktop_user", password="secret123")

        code = oauth_service._create_desktop_login_code(user)
        token = oauth_service.exchange_desktop_code(code)
        assert token.access_token

        with pytest.raises(BadRequestError, match="invalid"):
            oauth_service.exchange_desktop_code(code)
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


def test_openapi_available(client: TestClient) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert "openapi" in response.json()
