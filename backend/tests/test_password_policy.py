"""Password policy tests."""

import pytest

from backend.app.core.password_policy import validate_register_password


@pytest.mark.parametrize(
    "password",
    ["Secret123", "Aa1aaaa"],
)
def test_validate_register_password_accepts_valid(password: str) -> None:
    assert validate_register_password(password) == password


@pytest.mark.parametrize(
    ("password", "message"),
    [
        ("Aa1", "at least 6"),
        ("noupper123", "uppercase"),
        ("NOLOWER123", "lowercase"),
        ("NoDigits", "digit"),
        ("Bad-Pass1", "letters and digits"),
        ("space 1Aa", "letters and digits"),
    ],
)
def test_validate_register_password_rejects_invalid(password: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        validate_register_password(password)
