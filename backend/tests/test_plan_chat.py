"""Smoke tests for plan agents catalog + mock SSE chat."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def test_list_plan_agents():
    res = client.get("/api/v1/plan/agents")
    assert res.status_code == 200
    data = res.json()
    assert "agents" in data
    assert "models" in data
    assert data["defaultAgentId"]
    assert any(a["id"] == "travel-planner" for a in data["agents"])
    assert any(m["id"] == "gpt-5.5" for m in data["models"])


def test_plan_chat_mock_sse():
    res = client.post(
        "/api/v1/plan/chat",
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


def test_external_agent_rejected():
    res = client.post(
        "/api/v1/plan/chat",
        json={
            "agentId": "acp-external-expert",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert res.status_code == 400
