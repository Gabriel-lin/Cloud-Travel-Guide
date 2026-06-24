from __future__ import annotations

import hashlib
import json
import os
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.app.core.config import get_settings
from backend.app.core.exceptions import BadRequestError
from backend.app.core.password_rsa_key import generate_rsa_private_key_pem

_DEV_GENERATED_PRIVATE_KEY_PEM: str | None = None


@dataclass(frozen=True)
class PasswordTransportKeyMaterial:
    key_id: str
    private_key_pem: str
    public_key_pem: str


def _fingerprint_public_key(public_key_pem: str) -> str:
    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    public_der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return hashlib.sha256(public_der).hexdigest()[:16]


def _generate_dev_private_key_pem() -> str:
    return generate_rsa_private_key_pem()


@lru_cache
def get_password_transport_keys() -> PasswordTransportKeyMaterial:
    global _DEV_GENERATED_PRIVATE_KEY_PEM

    settings = get_settings()
    private_key_pem = settings.auth_password_rsa_private_key_pem

    if not private_key_pem:
        if settings.environment == "production":
            raise RuntimeError("AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM is required in production")
        if _DEV_GENERATED_PRIVATE_KEY_PEM is None:
            _DEV_GENERATED_PRIVATE_KEY_PEM = _generate_dev_private_key_pem()
        private_key_pem = _DEV_GENERATED_PRIVATE_KEY_PEM

    private_key = serialization.load_pem_private_key(
        private_key_pem.encode("utf-8"),
        password=None,
    )
    if not isinstance(private_key, rsa.RSAPrivateKey):
        raise RuntimeError("AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM must be an RSA private key")

    public_key_pem = (
        private_key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("utf-8")
    )
    return PasswordTransportKeyMaterial(
        key_id=_fingerprint_public_key(public_key_pem),
        private_key_pem=private_key_pem,
        public_key_pem=public_key_pem,
    )


def seal_password_for_transport(
    *,
    public_key_pem: str,
    key_id: str,
    password: str,
    ttl_seconds: int,
) -> dict[str, str]:
    payload = json.dumps(
        {
            "p": password,
            "n": str(uuid.uuid4()),
            "e": int(datetime.now(UTC).timestamp()) + ttl_seconds,
        },
        separators=(",", ":"),
    ).encode("utf-8")

    aes_key = AESGCM.generate_key(bit_length=256)
    iv = os.urandom(12)
    ciphertext = AESGCM(aes_key).encrypt(iv, payload, None)

    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    wrapped_key = public_key.encrypt(  # type: ignore[union-attr]
        aes_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )

    return {
        "key_id": key_id,
        "wrapped_key": _b64encode(wrapped_key),
        "iv": _b64encode(iv),
        "ciphertext": _b64encode(ciphertext),
    }


def open_password_envelope(
    envelope: dict[str, str],
    *,
    expected_key_id: str | None = None,
) -> tuple[str, str, datetime]:
    if expected_key_id and envelope.get("key_id") != expected_key_id:
        raise BadRequestError("Password envelope key mismatch")

    keys = get_password_transport_keys()
    private_key = serialization.load_pem_private_key(
        keys.private_key_pem.encode("utf-8"),
        password=None,
    )
    if not isinstance(private_key, rsa.RSAPrivateKey):
        raise BadRequestError("Invalid password transport key")

    try:
        wrapped_key = _b64decode(envelope["wrapped_key"])
        iv = _b64decode(envelope["iv"])
        ciphertext = _b64decode(envelope["ciphertext"])
    except (KeyError, ValueError) as exc:
        raise BadRequestError("Invalid password envelope") from exc

    aes_key = private_key.decrypt(
        wrapped_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    plaintext = AESGCM(aes_key).decrypt(iv, ciphertext, None)

    try:
        payload = json.loads(plaintext.decode("utf-8"))
        password = payload["p"]
        nonce = payload["n"]
        expires_at = datetime.fromtimestamp(int(payload["e"]), tz=UTC)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise BadRequestError("Invalid password envelope payload") from exc

    if datetime.now(UTC) > expires_at:
        raise BadRequestError("Password envelope expired")

    return password, nonce, expires_at


def _b64encode(data: bytes) -> str:
    import base64

    return base64.b64encode(data).decode("ascii")


def _b64decode(value: str) -> bytes:
    import base64

    return base64.b64decode(value.encode("ascii"))
