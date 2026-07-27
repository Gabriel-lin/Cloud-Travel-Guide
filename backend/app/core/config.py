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
        populate_by_name=True,
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

    # -------------------------------------------------------------------------
    # LLM / multi-model (LiteLLM). Prefer dedicated keys; or one OpenAI-compat gateway.
    # -------------------------------------------------------------------------
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_api_base: str | None = Field(default=None, alias="OPENAI_API_BASE")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    deepseek_api_key: str | None = Field(default=None, alias="DEEPSEEK_API_KEY")
    deepseek_api_base: str | None = Field(
        default="https://api.deepseek.com",
        alias="DEEPSEEK_API_BASE",
    )
    # Third-party OpenAI-compatible gateway (one base_url + key → many models)
    llm_openai_compat_base_url: str | None = Field(
        default=None,
        alias="LLM_OPENAI_COMPAT_BASE_URL",
    )
    llm_openai_compat_api_key: str | None = Field(
        default=None,
        alias="LLM_OPENAI_COMPAT_API_KEY",
    )
    llm_default_model: str = Field(default="gpt-5.5", alias="LLM_DEFAULT_MODEL")
    # JSON: {"gpt-5.5":"openai/gpt-5.5","opus-4.8":"anthropic/claude-opus-4-8",...}
    llm_model_aliases: str | None = Field(default=None, alias="LLM_MODEL_ALIASES")
    llm_allow_mock: bool = Field(default=True, alias="LLM_ALLOW_MOCK")

    # -------------------------------------------------------------------------
    # Agents — workspace + pluggable web search
    # -------------------------------------------------------------------------
    agent_workspace_dir: str = Field(
        default=".agent_workspace",
        alias="AGENT_WORKSPACE_DIR",
    )
    tavily_api_key: str | None = Field(default=None, alias="TAVILY_API_KEY")
    agent_search_provider: Literal["auto", "duckduckgo", "tavily"] = Field(
        default="auto",
        alias="AGENT_SEARCH_PROVIDER",
    )

    # -------------------------------------------------------------------------
    # Sandbox jobs (Docker / gVisor worker)
    # -------------------------------------------------------------------------
    sandbox_runtime: Literal["runc", "runsc"] = Field(
        default="runc",
        alias="SANDBOX_RUNTIME",
        description="Container runtime: runc (dev/Windows) or runsc/gVisor (Linux prod)",
    )
    sandbox_python_image: str = Field(
        default="cloud-travel-guide-sandbox-python:3.12",
        alias="SANDBOX_PYTHON_IMAGE",
    )
    sandbox_bash_image: str = Field(
        default="cloud-travel-guide-sandbox-python:3.12",
        alias="SANDBOX_BASH_IMAGE",
        description="Bash jobs use the same pre-built agent image (includes bash).",
    )
    sandbox_playwright_image: str = Field(
        default="cloud-travel-guide-sandbox-playwright:3.12",
        alias="SANDBOX_PLAYWRIGHT_IMAGE",
        description="Optional template with Chromium for HTML→PDF via Playwright (profile=playwright).",
    )
    sandbox_user: str = Field(default="65534:65534", alias="SANDBOX_USER")
    sandbox_memory_limit: str = Field(default="512m", alias="SANDBOX_MEMORY_LIMIT")
    sandbox_playwright_memory_limit: str = Field(
        default="1g",
        alias="SANDBOX_PLAYWRIGHT_MEMORY_LIMIT",
    )
    sandbox_playwright_shm_size: str = Field(
        default="256m",
        alias="SANDBOX_PLAYWRIGHT_SHM_SIZE",
        description="Shared memory for Chromium in playwright-profile jobs.",
    )
    sandbox_cpu_limit: float = Field(default=1.0, alias="SANDBOX_CPU_LIMIT")
    sandbox_pids_limit: int = Field(default=128, alias="SANDBOX_PIDS_LIMIT")
    sandbox_allow_network: bool = Field(default=False, alias="SANDBOX_ALLOW_NETWORK")
    sandbox_job_timeout_sec: int = Field(default=600, alias="SANDBOX_JOB_TIMEOUT_SEC")
    sandbox_tool_wait_sec: int = Field(
        default=600,
        alias="SANDBOX_TOOL_WAIT_SEC",
        description="Max seconds run_sandbox_job waits in-chat before returning jobId",
    )
    sandbox_poll_interval_sec: float = Field(default=1.5, alias="SANDBOX_POLL_INTERVAL_SEC")
    sandbox_worker_poll_sec: float = Field(default=2.0, alias="SANDBOX_WORKER_POLL_SEC")
    sandbox_max_concurrent_jobs_per_user: int = Field(
        default=2,
        alias="SANDBOX_MAX_CONCURRENT_JOBS_PER_USER",
    )
    sandbox_max_script_bytes: int = Field(default=64_000, alias="SANDBOX_MAX_SCRIPT_BYTES")
    sandbox_log_preview_bytes: int = Field(default=8_000, alias="SANDBOX_LOG_PREVIEW_BYTES")
    sandbox_job_lease_sec: int = Field(
        default=60,
        alias="SANDBOX_JOB_LEASE_SEC",
        description="How long a worker holds a running job before it can be reclaimed",
    )
    sandbox_job_heartbeat_sec: float = Field(
        default=15.0,
        alias="SANDBOX_JOB_HEARTBEAT_SEC",
        description="How often the worker renews the job lease while a container runs",
    )
    sandbox_workspace_volume: str | None = Field(
        default=None,
        alias="SANDBOX_WORKSPACE_VOLUME",
        description=(
            "Docker volume name shared with the worker (compose: ctg_agent_workspace). "
            "When set, sandbox containers mount this volume instead of a host bind path."
        ),
    )

    # -------------------------------------------------------------------------
    # Document export (Markdown → PDF)
    # -------------------------------------------------------------------------
    document_mermaid_render: bool = Field(
        default=True,
        alias="DOCUMENT_MERMAID_RENDER",
        description="Pre-render ```mermaid``` blocks to PNG when exporting PDF via WeasyPrint.",
    )
    mermaid_ink_base_url: str = Field(
        default="https://mermaid.ink/img",
        alias="MERMAID_INK_BASE_URL",
        description="Base URL for mermaid.ink raster rendering (WeasyPrint path; use /img not /svg).",
    )
    document_mermaid_timeout_sec: float = Field(
        default=20.0,
        alias="DOCUMENT_MERMAID_TIMEOUT_SEC",
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
