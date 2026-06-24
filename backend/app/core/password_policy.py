from __future__ import annotations

import re

_PASSWORD_ALLOWED = re.compile(r"^[a-zA-Z0-9]+$")
_HAS_LOWER = re.compile(r"[a-z]")
_HAS_UPPER = re.compile(r"[A-Z]")
_HAS_DIGIT = re.compile(r"\d")

REGISTER_PASSWORD_MIN_LENGTH = 6
REGISTER_PASSWORD_MAX_LENGTH = 128


def validate_register_password(password: str) -> str:
    if len(password) < REGISTER_PASSWORD_MIN_LENGTH:
        raise ValueError(f"Password must be at least {REGISTER_PASSWORD_MIN_LENGTH} characters")
    if len(password) > REGISTER_PASSWORD_MAX_LENGTH:
        raise ValueError(f"Password must be at most {REGISTER_PASSWORD_MAX_LENGTH} characters")
    if not _PASSWORD_ALLOWED.fullmatch(password):
        raise ValueError("Password may only contain letters and digits")
    if not _HAS_LOWER.search(password):
        raise ValueError("Password must contain a lowercase letter")
    if not _HAS_UPPER.search(password):
        raise ValueError("Password must contain an uppercase letter")
    if not _HAS_DIGIT.search(password):
        raise ValueError("Password must contain a digit")
    return password
