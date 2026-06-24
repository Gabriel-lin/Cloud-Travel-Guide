from backend.app.core.password_transport import (
    get_password_transport_keys,
    open_password_envelope,
    seal_password_for_transport,
)


def test_password_transport_roundtrip() -> None:
    keys = get_password_transport_keys()
    envelope = seal_password_for_transport(
        public_key_pem=keys.public_key_pem,
        key_id=keys.key_id,
        password="Secret123",
        ttl_seconds=60,
    )
    password, _nonce, _expires_at = open_password_envelope(
        envelope,
        expected_key_id=keys.key_id,
    )
    assert password == "Secret123"
