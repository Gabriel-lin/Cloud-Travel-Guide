from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, TypedDict
from urllib.parse import urlencode, urlparse

import httpx
import jwt
from sqlalchemy.orm import Session

from backend.app.core.config import OAuthProvider, get_settings
from backend.app.core.constants import (
    OAUTH_AUTHORIZE_URLS,
    OAUTH_TOKEN_URLS,
    OAUTH_USER_URLS,
)
from backend.app.core.exceptions import BadRequestError, ServiceUnavailableError
from backend.app.models.oauth_account import OAuthAccount
from backend.app.models.user import User
from backend.app.repositories import OAuthRepository, UserRepository
from backend.app.schemas.auth import OAuthStatePayload, TokenResponse
from backend.app.services.auth_service import AuthService


class ParsedOAuthProfile(TypedDict):
    provider_user_id: str
    username: str
    display_name: str | None
    email: str | None
    avatar_url: str | None


class OAuthService:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._users = UserRepository(db)
        self._oauth = OAuthRepository(db)
        self._auth = AuthService(db)

    def build_authorize_url(self, provider: OAuthProvider, redirect_uri: str) -> str:
        redirect_uri = self._validate_redirect_uri(redirect_uri)
        client_id, _ = self._provider_credentials(provider)
        backend_callback = self._backend_callback_url(provider)

        state_payload = OAuthStatePayload(
            provider=provider,
            redirect_uri=redirect_uri,
            nonce=secrets.token_urlsafe(16),
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        state = self._encode_state(state_payload)

        if provider == "github":
            params = {
                "client_id": client_id,
                "redirect_uri": backend_callback,
                "scope": "read:user user:email",
                "state": state,
            }
        else:
            params = {
                "client_id": client_id,
                "redirect_uri": backend_callback,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "access_type": "offline",
                "prompt": "consent",
            }

        return f"{OAUTH_AUTHORIZE_URLS[provider]}?{httpx.QueryParams(params)}"

    async def handle_callback(
        self,
        *,
        provider: OAuthProvider,
        code: str,
        state: str,
    ) -> str:
        state_payload = self._decode_state(state)
        frontend_redirect_uri = self._validate_redirect_uri(state_payload.redirect_uri)
        if state_payload.provider != provider:
            raise BadRequestError("OAuth provider mismatch")
        if state_payload.expires_at < datetime.now(UTC):
            raise BadRequestError("OAuth state expired")

        _, token = await self.complete_login(
            provider=provider,
            code=code,
            redirect_uri=self._backend_callback_url(provider),
        )
        return self._build_frontend_redirect(frontend_redirect_uri, token)

    async def complete_login(
        self,
        *,
        provider: OAuthProvider,
        code: str,
        redirect_uri: str,
    ) -> tuple[User, TokenResponse]:
        token_data = await self._exchange_code(provider, code, redirect_uri)
        access_token = token_data.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise BadRequestError("OAuth provider did not return an access token")
        refresh_token = token_data.get("refresh_token")

        profile = await self._fetch_profile(provider, access_token)
        user = self._upsert_user(
            provider=provider,
            profile=profile,
            access_token=access_token,
            refresh_token=refresh_token if isinstance(refresh_token, str) else None,
        )
        return user, self._auth.issue_token(user)

    def _upsert_user(
        self,
        *,
        provider: OAuthProvider,
        profile: dict[str, Any],
        access_token: str | None,
        refresh_token: str | None,
    ) -> User:
        parsed = self._parse_profile(provider, profile)
        if not parsed["provider_user_id"]:
            raise BadRequestError("OAuth profile is missing a user id")

        oauth_account = self._oauth.get_account(
            provider=provider,
            provider_user_id=parsed["provider_user_id"],
        )

        if oauth_account:
            user = oauth_account.user
            user.email = parsed["email"] or user.email
            user.display_name = parsed["display_name"] or user.display_name
            user.avatar_url = parsed["avatar_url"] or user.avatar_url
            user.provider = provider
            oauth_account.access_token = access_token
            oauth_account.refresh_token = refresh_token
            return self._users.save(user)

        existing_user = self._users.get_by_email(parsed["email"]) if parsed["email"] else None
        if existing_user:
            existing_user.provider = provider
            existing_user.display_name = parsed["display_name"] or existing_user.display_name
            existing_user.avatar_url = parsed["avatar_url"] or existing_user.avatar_url
            self._db.flush()
            self._oauth.add_account(
                OAuthAccount(
                    user_id=existing_user.id,
                    provider=provider,
                    provider_user_id=parsed["provider_user_id"],
                    access_token=access_token,
                    refresh_token=refresh_token,
                )
            )
            return self._users.get_by_id(existing_user.id) or existing_user

        user = User(
            username=self._unique_username(parsed["username"], provider),
            email=parsed["email"],
            display_name=parsed["display_name"],
            avatar_url=parsed["avatar_url"],
            provider=provider,
            password_hash=None,
        )
        self._db.add(user)
        self._db.flush()

        user.provider = provider
        self._oauth.add_account(
            OAuthAccount(
                user_id=user.id,
                provider=provider,
                provider_user_id=parsed["provider_user_id"],
                access_token=access_token,
                refresh_token=refresh_token,
            )
        )
        return self._users.get_by_id(user.id) or user

    def _unique_username(self, base: str, provider: OAuthProvider) -> str:
        candidate = (base[:40] or f"{provider}_user").strip()
        suffix = 1
        username = candidate
        while self._users.username_exists(username):
            username = f"{candidate}_{suffix}"
            suffix += 1
        return username

    @staticmethod
    def _parse_profile(provider: OAuthProvider, profile: dict[str, Any]) -> ParsedOAuthProfile:
        if provider == "github":
            provider_user_id = str(profile.get("id") or "")
            username = OAuthService._profile_str(profile, "login") or f"github_{provider_user_id}"
            return {
                "provider_user_id": provider_user_id,
                "username": username,
                "display_name": OAuthService._profile_str(profile, "name") or username,
                "email": OAuthService._profile_str(profile, "email"),
                "avatar_url": OAuthService._profile_str(profile, "avatar_url"),
            }

        provider_user_id = str(profile.get("id") or profile.get("sub") or "")
        email = OAuthService._profile_str(profile, "email")
        username = (
            email.split("@")[0] if email else OAuthService._profile_str(profile, "name")
        ) or "google_user"
        return {
            "provider_user_id": provider_user_id,
            "username": username,
            "display_name": OAuthService._profile_str(profile, "name"),
            "email": email,
            "avatar_url": OAuthService._profile_str(profile, "picture"),
        }

    async def _exchange_code(
        self,
        provider: OAuthProvider,
        code: str,
        redirect_uri: str,
    ) -> dict[str, Any]:
        client_id, client_secret = self._provider_credentials(provider)
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        }
        if provider == "google":
            data["grant_type"] = "authorization_code"

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                OAUTH_TOKEN_URLS[provider],
                data=data,
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise BadRequestError("OAuth provider returned an invalid token response")
            return data

    async def _fetch_profile(self, provider: OAuthProvider, access_token: str) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
        if provider == "github":
            headers["User-Agent"] = "Cloud-Travel-Guide"

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(OAUTH_USER_URLS[provider], headers=headers)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise BadRequestError("OAuth provider returned an invalid profile response")
            return data

    @staticmethod
    def _profile_str(profile: dict[str, Any], key: str) -> str | None:
        value = profile.get(key)
        return value if isinstance(value, str) and value else None

    @staticmethod
    def _build_frontend_redirect(redirect_uri: str, token: TokenResponse) -> str:
        query = urlencode(
            {
                "access_token": token.access_token,
                "token_type": token.token_type,
                "expires_in": str(token.expires_in),
            }
        )
        separator = "&" if "?" in redirect_uri else "?"
        return f"{redirect_uri}{separator}{query}"

    @staticmethod
    def _validate_redirect_uri(redirect_uri: str) -> str:
        parsed = urlparse(redirect_uri)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.fragment:
            raise BadRequestError("Invalid OAuth redirect URI")

        redirect_origin = OAuthService._url_origin(redirect_uri)
        allowed_origins = {
            OAuthService._url_origin(origin) for origin in get_settings().oauth_redirect_origins
        }
        if redirect_origin not in allowed_origins:
            raise BadRequestError("OAuth redirect URI origin is not allowed")
        return redirect_uri

    @staticmethod
    def _url_origin(value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise BadRequestError("Invalid OAuth redirect origin configuration")
        return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"

    @staticmethod
    def _encode_state(payload: OAuthStatePayload) -> str:
        settings = get_settings()
        return jwt.encode(
            payload.model_dump(mode="json"),
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )

    @staticmethod
    def _decode_state(state: str) -> OAuthStatePayload:
        settings = get_settings()
        try:
            data = jwt.decode(state, settings.secret_key, algorithms=[settings.jwt_algorithm])
            return OAuthStatePayload.model_validate(data)
        except jwt.PyJWTError as exc:
            raise BadRequestError("Invalid OAuth state") from exc

    @staticmethod
    def _provider_credentials(provider: OAuthProvider) -> tuple[str, str]:
        settings = get_settings()
        if provider == "github":
            if not settings.github_client_id or not settings.github_client_secret:
                raise ServiceUnavailableError("GitHub OAuth is not configured")
            return settings.github_client_id, settings.github_client_secret
        if not settings.google_client_id or not settings.google_client_secret:
            raise ServiceUnavailableError("Google OAuth is not configured")
        return settings.google_client_id, settings.google_client_secret

    @staticmethod
    def _backend_callback_url(provider: OAuthProvider) -> str:
        base = get_settings().oauth_backend_callback_base.rstrip("/")
        return f"{base}/api/v1/auth/oauth/{provider}/callback"
