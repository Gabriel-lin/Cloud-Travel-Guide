from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

import httpx
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
from backend.app.models.oauth_account import OAuthAccount
from backend.app.models.user import User
from backend.app.repositories import OAuthRepository, TokenRepository, UserRepository
from backend.app.schemas.auth import AuthUserResponse, TokenResponse

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._users = UserRepository(db)
        self._tokens = TokenRepository(db)
        self._oauth = OAuthRepository(db)

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

        user_id = self._payload_user_id(payload)
        self._revoke_oauth_accounts(user_id)

        expires_at = datetime.fromtimestamp(exp, tz=UTC)
        self._tokens.blacklist(jti=jti, expires_at=expires_at)

    def get_current_user(self, token: str) -> User:
        payload = self._decode_token(token)

        if payload.get("type") != "access":
            raise UnauthorizedError("Invalid token type")

        jti = payload.get("jti")
        if not jti or self._tokens.is_blacklisted(jti):
            raise UnauthorizedError("Token has been invalidated")

        user_id = self._payload_user_id(payload)
        user = self._users.get_by_id(user_id)
        if not user:
            raise UnauthorizedError("User not found")
        return user

    @staticmethod
    def serialize_user(user: User) -> AuthUserResponse:
        return AuthUserResponse.from_db_user(user)

    @staticmethod
    def _payload_user_id(payload: dict) -> uuid.UUID:
        subject = payload.get("sub")
        if not subject:
            raise UnauthorizedError("Invalid token subject")
        try:
            return uuid.UUID(subject)
        except ValueError as exc:
            raise UnauthorizedError("Invalid token subject") from exc

    def _revoke_oauth_accounts(self, user_id: uuid.UUID) -> None:
        accounts = self._oauth.get_accounts_by_user_id(user_id)
        changed = False
        for account in accounts:
            if not account.access_token and not account.refresh_token:
                continue
            self._revoke_provider_token(account)
            account.access_token = None
            account.refresh_token = None
            changed = True

        if changed:
            self._oauth.save()

    def _revoke_provider_token(self, account: OAuthAccount) -> None:
        try:
            if account.provider == AuthProvider.GITHUB and account.access_token:
                self._revoke_github_grant(account.access_token)
            elif account.provider == AuthProvider.GOOGLE:
                token = account.refresh_token or account.access_token
                if token:
                    self._revoke_google_token(token)
        except httpx.HTTPError as exc:
            logger.warning(
                "Failed to revoke %s OAuth authorization for user %s",
                account.provider,
                account.user_id,
                exc_info=exc,
            )

    @staticmethod
    def _revoke_github_grant(access_token: str) -> None:
        settings = get_settings()
        if not settings.github_client_id or not settings.github_client_secret:
            return

        with httpx.Client(timeout=10.0) as client:
            response = client.request(
                "DELETE",
                f"https://api.github.com/applications/{settings.github_client_id}/grant",
                auth=httpx.BasicAuth(settings.github_client_id, settings.github_client_secret),
                json={"access_token": access_token},
                headers={"Accept": "application/vnd.github+json"},
            )
            response.raise_for_status()

    @staticmethod
    def _revoke_google_token(token: str) -> None:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                "https://oauth2.googleapis.com/revoke",
                data={"token": token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()

    @staticmethod
    def _decode_token(token: str) -> dict:
        try:
            return decode_access_token(token)
        except jwt.PyJWTError as exc:
            raise UnauthorizedError("Could not validate credentials") from exc
