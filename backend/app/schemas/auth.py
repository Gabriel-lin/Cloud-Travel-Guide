from datetime import datetime
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.user import User


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class MessageResponse(BaseModel):
    message: str


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=128)


class AuthUserResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
    )

    id: str
    username: str
    display_name: str | None = Field(default=None, serialization_alias="displayName")
    email: str | None = None
    avatar_url: str | None = Field(default=None, serialization_alias="avatarUrl")
    provider: Literal["local", "github", "google"] = "local"

    @classmethod
    def from_db_user(cls, user: User) -> "AuthUserResponse":
        return cls(
            id=str(user.id),
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            avatar_url=user.avatar_url,
            provider=cast(Literal["local", "github", "google"], user.provider),
        )


class OAuthExchangeRequest(BaseModel):
    provider: Literal["github", "google"]
    code: str
    redirect_uri: str


class OAuthStatePayload(BaseModel):
    provider: Literal["github", "google"]
    redirect_uri: str
    nonce: str
    expires_at: datetime
