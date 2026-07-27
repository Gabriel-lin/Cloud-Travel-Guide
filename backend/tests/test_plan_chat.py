"""Smoke tests for plan agents catalog + authenticated mock SSE chat."""

from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-secret-key-with-at-least-32-bytes"
os.environ["LLM_ALLOW_MOCK"] = "true"

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


def _auth_headers(client: TestClient, username: str = "chat_user") -> dict[str, str]:
    register_user(client, username=username, password="Secret123")
    token = login_user(client, username=username, password="Secret123")["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_list_plan_agents(client: TestClient) -> None:
    res = client.get("/api/v1/plan/agents")
    assert res.status_code == 200
    data = res.json()
    assert "agents" in data
    assert "models" in data
    assert data["defaultAgentId"]
    assert any(a["id"] == "travel-planner" for a in data["agents"])
    assert any(m["id"] == "gpt-5.5" for m in data["models"])
    assert any(m["id"] == "deepseek-v4-pro" for m in data["models"])
    assert data.get("defaultModelId") in {
        "gpt-5.5",
        "opus-4.8",
        "deepseek-v4-pro",
    }


def test_plan_chat_requires_auth(client: TestClient) -> None:
    res = client.post(
        "/api/v1/plan/chat",
        json={
            "agentId": "travel-planner",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert res.status_code == 401


def test_plan_chat_mock_sse(client: TestClient) -> None:
    headers = _auth_headers(client)
    res = client.post(
        "/api/v1/plan/chat",
        headers=headers,
        json={
            "agentId": "travel-planner",
            "messages": [{"role": "user", "content": "帮我规划三天成都"}],
        },
    )
    assert res.status_code == 200
    assert "text/event-stream" in res.headers["content-type"]
    body = res.text
    assert "data: " in body
    events = []
    for line in body.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    types = [e["type"] for e in events]
    assert "start" in types
    assert "delta" in types
    assert "done" in types


def test_external_agent_rejected(client: TestClient) -> None:
    headers = _auth_headers(client, username="ext_user")
    res = client.post(
        "/api/v1/plan/chat",
        headers=headers,
        json={
            "agentId": "acp-external-expert",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert res.status_code == 400
