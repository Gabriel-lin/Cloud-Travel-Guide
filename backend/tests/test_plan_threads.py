"""API smoke tests for plan chat thread cloud sync."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-secret-key-with-at-least-32-bytes"

from backend.app.core.database import Base, get_db
from backend.app.main import create_app
from backend.tests.auth_transport import login_user, register_user


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


def _auth_headers(client: TestClient, username: str = "thread_user") -> dict[str, str]:
    register_user(client, username=username, password="Secret123")
    token = login_user(client, username=username, password="Secret123")["access_token"]
    return {"Authorization": f"Bearer {token}"}


THREAD_ID = "thread-abc-123"


def test_plan_threads_require_auth(client: TestClient) -> None:
    res = client.get("/api/v1/plan/threads")
    assert res.status_code == 401


def test_initialize_and_list_thread(client: TestClient) -> None:
    headers = _auth_headers(client)
    init = client.post(
        "/api/v1/plan/threads",
        headers=headers,
        json={"threadId": THREAD_ID},
    )
    assert init.status_code == 201
    assert init.json()["remoteId"] == THREAD_ID

    listed = client.get("/api/v1/plan/threads", headers=headers)
    assert listed.status_code == 200
    threads = listed.json()["threads"]
    assert any(t["remoteId"] == THREAD_ID for t in threads)


def test_thread_history_roundtrip(client: TestClient) -> None:
    headers = _auth_headers(client, username="hist_user")
    client.post(
        "/api/v1/plan/threads",
        headers=headers,
        json={"threadId": THREAD_ID},
    )

    payload = {
        "messages": [{"message": {"id": "m1", "role": "user"}, "parentId": None}],
        "headId": "m1",
    }
    put = client.put(
        f"/api/v1/plan/threads/{THREAD_ID}/history",
        headers=headers,
        json=payload,
    )
    assert put.status_code == 200

    got = client.get(f"/api/v1/plan/threads/{THREAD_ID}/history", headers=headers)
    assert got.status_code == 200
    data = got.json()
    assert data["headId"] == "m1"
    assert len(data["messages"]) == 1


def test_thread_isolation_between_users(client: TestClient) -> None:
    headers_a = _auth_headers(client, username="user_a")
    headers_b = _auth_headers(client, username="user_b")
    client.post(
        "/api/v1/plan/threads",
        headers=headers_a,
        json={"threadId": THREAD_ID},
    )

    res = client.get(f"/api/v1/plan/threads/{THREAD_ID}", headers=headers_b)
    assert res.status_code == 404
