from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.core.config import get_settings
from backend.app.core.password_transport import (
    get_password_transport_keys,
    seal_password_for_transport,
)


def seal_password_for_request(client: TestClient, password: str) -> dict[str, str]:
    keys = get_password_transport_keys()
    ttl = get_settings().auth_password_envelope_ttl_seconds
    return seal_password_for_transport(
        public_key_pem=keys.public_key_pem,
        key_id=keys.key_id,
        password=password,
        ttl_seconds=ttl,
    )


def register_user(
    client: TestClient,
    *,
    username: str,
    password: str,
) -> None:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "password_envelope": seal_password_for_request(client, password),
        },
    )
    assert response.status_code == 201, response.text


def login_user(
    client: TestClient,
    *,
    username: str,
    password: str,
) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "username": username,
            "password_envelope": seal_password_for_request(client, password),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()
