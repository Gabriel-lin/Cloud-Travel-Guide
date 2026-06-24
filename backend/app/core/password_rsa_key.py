from __future__ import annotations

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

RSA_KEY_SIZE = 2048
RSA_PUBLIC_EXPONENT = 65537


def generate_rsa_private_key_pem() -> str:
    private_key = rsa.generate_private_key(
        public_exponent=RSA_PUBLIC_EXPONENT,
        key_size=RSA_KEY_SIZE,
    )
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return pem.decode("utf-8")


def normalize_pem_from_env(value: str | None) -> str | None:
    """Normalize PEM stored in .env / CI secrets (supports escaped newlines)."""
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    if (normalized.startswith('"') and normalized.endswith('"')) or (
        normalized.startswith("'") and normalized.endswith("'")
    ):
        normalized = normalized[1:-1]

    if "\\n" in normalized:
        normalized = normalized.replace("\\n", "\n")

    return normalized if normalized else None


def format_pem_for_env(pem: str) -> str:
    """Single-line escaped PEM suitable for AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM."""
    return pem.replace("\n", "\\n").strip()
