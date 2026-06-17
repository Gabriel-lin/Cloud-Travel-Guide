from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm

from backend.app.api.deps import (
    get_auth_service,
    get_current_user,
    get_oauth_service,
    oauth2_scheme,
)
from backend.app.core.config import OAuthProvider
from backend.app.models.user import User
from backend.app.schemas.auth import (
    AuthUserResponse,
    MessageResponse,
    OAuthExchangeRequest,
    RegisterRequest,
    TokenResponse,
)
from backend.app.services.auth_service import AuthService
from backend.app.services.oauth_service import OAuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/token")
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> TokenResponse:
    return auth_service.login(username=form_data.username, password=form_data.password)


@router.post("/logout")
def logout(
    token: Annotated[str, Depends(oauth2_scheme)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> MessageResponse:
    auth_service.logout(token)
    return MessageResponse(message="Successfully logged out")


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    username: str,
    password: str,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> MessageResponse:
    auth_service.register(username=username, password=password)
    return MessageResponse(message="User registered successfully")


@router.post("/register/json", status_code=status.HTTP_201_CREATED)
def register_json(
    payload: RegisterRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> MessageResponse:
    auth_service.register(username=payload.username, password=payload.password)
    return MessageResponse(message="User registered successfully")


@router.get("/me", response_model_by_alias=True)
def read_current_user(
    current_user: Annotated[User, Depends(get_current_user)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> AuthUserResponse:
    return auth_service.serialize_user(current_user)


@router.get("/oauth/{provider}")
def oauth_authorize(
    provider: OAuthProvider,
    redirect_uri: Annotated[str, Query()],
    oauth_service: Annotated[OAuthService, Depends(get_oauth_service)],
) -> RedirectResponse:
    url = oauth_service.build_authorize_url(provider, redirect_uri)
    return RedirectResponse(url=url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.get("/oauth/{provider}/callback")
async def oauth_callback(
    provider: OAuthProvider,
    code: Annotated[str, Query()],
    state: Annotated[str, Query()],
    oauth_service: Annotated[OAuthService, Depends(get_oauth_service)],
) -> RedirectResponse:
    target = await oauth_service.handle_callback(provider=provider, code=code, state=state)
    return RedirectResponse(url=target, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.post("/oauth/exchange")
async def oauth_exchange(
    payload: OAuthExchangeRequest,
    oauth_service: Annotated[OAuthService, Depends(get_oauth_service)],
) -> TokenResponse:
    _, token = await oauth_service.complete_login(
        provider=payload.provider,
        code=payload.code,
        redirect_uri=payload.redirect_uri,
    )
    return token
