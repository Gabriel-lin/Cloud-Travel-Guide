from __future__ import annotations

import uuid
from datetime import UTC, datetime

import jwt
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.core.constants import AuthProvider
from backend.app.core.exceptions import (
    BadRequestError,
    ConflictError,
    UnauthorizedError,
)
from backend.app.core.security import (
    create_access_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)
from backend.app.models.user import User
from backend.app.repositories import TokenRepository, UserRepository
from backend.app.schemas.auth import AuthUserResponse, TokenResponse


class AuthService:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._users = UserRepository(db)
        self._tokens = TokenRepository(db)

    def register(self, *, username: str, password: str) -> User:
        if self._users.username_exists(username):
            raise ConflictError("Username already exists")

        return self._users.add(
            User(
                username=username,
                password_hash=get_password_hash(password),
                display_name=username,
                provider=AuthProvider.LOCAL,
            )
        )

    def issue_token(self, user: User) -> TokenResponse:
        settings = get_settings()
        token, _expire, _jti = create_access_token(
            subject=str(user.id),
            username=user.username,
        )
        return TokenResponse(
            access_token=token,
            token_type="bearer",
            expires_in=settings.access_token_expire_minutes * 60,
        )

    def login(self, *, username: str, password: str) -> TokenResponse:
        user = self._users.get_by_username(username)
        if not user or not verify_password(password, user.password_hash):
            raise UnauthorizedError("Incorrect username or password")
        return self.issue_token(user)

    def logout(self, token: str) -> None:
        payload = self._decode_token(token)
        jti = payload.get("jti")
        exp = payload.get("exp")
        if not jti or not exp:
            raise UnauthorizedError("Invalid token payload")

        if self._tokens.is_blacklisted(jti):
            raise BadRequestError("Token already invalidated")

        expires_at = datetime.fromtimestamp(exp, tz=UTC)
        self._tokens.blacklist(jti=jti, expires_at=expires_at)

    def get_current_user(self, token: str) -> User:
        payload = self._decode_token(token)

        if payload.get("type") != "access":
            raise UnauthorizedError("Invalid token type")

        jti = payload.get("jti")
        if not jti or self._tokens.is_blacklisted(jti):
            raise UnauthorizedError("Token has been invalidated")

        subject = payload.get("sub")
        if not subject:
            raise UnauthorizedError("Invalid token subject")

        try:
            user_id = uuid.UUID(subject)
        except ValueError as exc:
            raise UnauthorizedError("Invalid token subject") from exc

        user = self._users.get_by_id(user_id)
        if not user:
            raise UnauthorizedError("User not found")
        return user

    @staticmethod
    def serialize_user(user: User) -> AuthUserResponse:
        return AuthUserResponse.from_db_user(user)

    @staticmethod
    def _decode_token(token: str) -> dict:
        try:
            return decode_access_token(token)
        except jwt.PyJWTError as exc:
            raise UnauthorizedError("Could not validate credentials") from exc
