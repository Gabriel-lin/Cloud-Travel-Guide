from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import RedirectResponse, Response
from fastapi.security import OAuth2PasswordRequestForm

from backend.app.api.deps import (
    get_auth_service,
    get_current_token,
    get_current_user,
    get_oauth_service,
)
from backend.app.core.config import AUTH_COOKIE_NAME, OAuthProvider, get_settings
from backend.app.models.user import User
from backend.app.schemas.auth import (
    AuthUserResponse,
    MessageResponse,
    OAuthDesktopExchangeRequest,
    OAuthExchangeRequest,
    RegisterRequest,
    TokenResponse,
)
from backend.app.services.auth_service import AuthService
from backend.app.services.oauth_service import OAuthService

router = APIRouter(prefix="/auth", tags=["auth"])


def set_auth_cookie(response: Response, token: TokenResponse) -> None:
    settings = get_settings()
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token.access_token,
        max_age=token.expires_in,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/token")
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> TokenResponse:
    return auth_service.login(username=form_data.username, password=form_data.password)


@router.post("/logout")
def logout(
    response: Response,
    token: Annotated[str, Depends(get_current_token)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> MessageResponse:
    auth_service.logout(token)
    clear_auth_cookie(response)
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
    client_type: Annotated[Literal["web", "desktop"], Query()] = "web",
) -> RedirectResponse:
    url = oauth_service.build_authorize_url(provider, redirect_uri, client_type)
    return RedirectResponse(url=url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.get("/oauth/{provider}/callback")
async def oauth_callback(
    provider: OAuthProvider,
    code: Annotated[str, Query()],
    state: Annotated[str, Query()],
    oauth_service: Annotated[OAuthService, Depends(get_oauth_service)],
) -> RedirectResponse:
    target, token = await oauth_service.handle_callback(provider=provider, code=code, state=state)
    response = RedirectResponse(url=target, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    if token is not None:
        set_auth_cookie(response, token)
    return response


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


@router.post("/oauth/desktop/exchange")
def oauth_desktop_exchange(
    payload: OAuthDesktopExchangeRequest,
    oauth_service: Annotated[OAuthService, Depends(get_oauth_service)],
) -> TokenResponse:
    return oauth_service.exchange_desktop_code(payload.code)
