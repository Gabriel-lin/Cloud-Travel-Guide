from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from backend.app.core.password_rsa_key import normalize_pem_from_env

OAuthProvider = Literal["github", "google"]
DEFAULT_SECRET_KEY = "change-me-in-production-use-openssl-rand-hex-32"
AUTH_COOKIE_NAME = "ctg_access_token"
LOCAL_FRONTEND_ORIGINS = [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Cloud Travel Guide API"
    debug: bool = False
    environment: str = Field(default="development", alias="ENVIRONMENT")

    database_url: str = Field(
        default="postgresql://user:password@localhost:5432/cloud_travel_guide",
        alias="DATABASE_URL",
    )

    secret_key: str = Field(
        default=DEFAULT_SECRET_KEY,
        alias="SECRET_KEY",
    )
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = Field(
        default=60 * 24 * 7, alias="ACCESS_TOKEN_EXPIRE_MINUTES"
    )
    auth_cookie_secure: bool = Field(default=False, alias="AUTH_COOKIE_SECURE")
    desktop_oauth_redirect_uri: str = Field(
        default="cloud-travel-guide://auth/callback",
        alias="DESKTOP_OAUTH_REDIRECT_URI",
    )
    desktop_oauth_code_expire_seconds: int = Field(
        default=120,
        alias="DESKTOP_OAUTH_CODE_EXPIRE_SECONDS",
    )
    auth_password_rsa_private_key_pem: str | None = Field(
        default=None,
        alias="AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM",
    )
    auth_password_envelope_ttl_seconds: int = Field(
        default=60,
        alias="AUTH_PASSWORD_ENVELOPE_TTL_SECONDS",
    )

    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: LOCAL_FRONTEND_ORIGINS.copy(),
        alias="CORS_ORIGINS",
    )
    oauth_redirect_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: LOCAL_FRONTEND_ORIGINS.copy(),
        alias="OAUTH_REDIRECT_ORIGINS",
    )

    github_client_id: str | None = Field(default=None, alias="GITHUB_CLIENT_ID")
    github_client_secret: str | None = Field(default=None, alias="GITHUB_CLIENT_SECRET")
    google_client_id: str | None = Field(default=None, alias="GOOGLE_CLIENT_ID")
    google_client_secret: str | None = Field(default=None, alias="GOOGLE_CLIENT_SECRET")

    oauth_backend_callback_base: str = Field(
        default="http://127.0.0.1:8000",
        alias="OAUTH_BACKEND_CALLBACK_BASE",
    )

    @field_validator("environment", mode="before")
    @classmethod
    def normalize_environment(cls, value: str) -> str:
        return value.lower().strip()

    @field_validator("cors_origins", "oauth_redirect_origins", mode="before")
    @classmethod
    def parse_origin_list(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("auth_password_rsa_private_key_pem", mode="before")
    @classmethod
    def normalize_auth_password_rsa_private_key_pem(cls, value: str | None) -> str | None:
        return normalize_pem_from_env(value)

    @model_validator(mode="after")
    def validate_security_settings(self) -> "Settings":
        if self.access_token_expire_minutes <= 0:
            raise ValueError("ACCESS_TOKEN_EXPIRE_MINUTES must be greater than 0")
        if self.desktop_oauth_code_expire_seconds <= 0:
            raise ValueError("DESKTOP_OAUTH_CODE_EXPIRE_SECONDS must be greater than 0")

        production = self.environment == "production"
        if production and self.debug:
            raise ValueError("DEBUG must be disabled in production")
        if production and (self.secret_key == DEFAULT_SECRET_KEY or len(self.secret_key) < 32):
            raise ValueError("SECRET_KEY must be a non-default value of at least 32 characters")
        if production and not self.auth_cookie_secure:
            raise ValueError("AUTH_COOKIE_SECURE must be enabled in production")
        if production and not self.auth_password_rsa_private_key_pem:
            raise ValueError("AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM is required in production")
        if self.auth_password_envelope_ttl_seconds <= 0:
            raise ValueError("AUTH_PASSWORD_ENVELOPE_TTL_SECONDS must be greater than 0")
        if production and ("*" in self.cors_origins or "*" in self.oauth_redirect_origins):
            raise ValueError("Wildcard origins are not allowed in production")

        self._validate_oauth_provider("GitHub", self.github_client_id, self.github_client_secret)
        self._validate_oauth_provider("Google", self.google_client_id, self.google_client_secret)
        return self

    @staticmethod
    def _validate_oauth_provider(
        name: str, client_id: str | None, client_secret: str | None
    ) -> None:
        if bool(client_id) != bool(client_secret):
            raise ValueError(f"{name} OAuth requires both client id and client secret")


@lru_cache
def get_settings() -> Settings:
    return Settings()
