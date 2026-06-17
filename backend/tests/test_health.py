"""Legacy smoke tests — see test_auth.py for application coverage."""

from fastapi.testclient import TestClient

from main import app


def test_openapi_available() -> None:
    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert "openapi" in response.json()
