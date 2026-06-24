from app.core.password_rsa_key import format_pem_for_env, normalize_pem_from_env


def test_normalize_pem_from_env_supports_escaped_newlines() -> None:
    pem = "-----BEGIN PRIVATE KEY-----\\nline-one\\n-----END PRIVATE KEY-----\\n"
    normalized = normalize_pem_from_env(pem)
    assert normalized is not None
    assert normalized.startswith("-----BEGIN PRIVATE KEY-----\n")
    assert normalized.endswith("-----END PRIVATE KEY-----\n")


def test_format_pem_for_env_roundtrip() -> None:
    pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n"
    escaped = format_pem_for_env(pem)
    assert normalize_pem_from_env(escaped) == pem
