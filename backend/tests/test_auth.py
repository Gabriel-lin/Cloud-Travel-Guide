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

from backend.app.core.database import Base, get_db
from backend.app.main import create_app


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


def test_openapi_available(client: TestClient) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert "openapi" in response.json()
