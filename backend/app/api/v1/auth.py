from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from backend.app.api.deps import (
    get_auth_service,
    get_current_token,
    get_current_user,
    get_oauth_service,
    get_password_cipher_service,
)
from backend.app.core.config import AUTH_COOKIE_NAME, OAuthProvider, get_settings
from backend.app.models.user import User
from backend.app.schemas.auth import (
    AuthUserResponse,
    LoginRequest,
    MessageResponse,
    OAuthDesktopExchangeRequest,
    OAuthExchangeRequest,
    PasswordKeyResponse,
    RegisterRequest,
    TokenResponse,
)
from backend.app.services.auth_service import AuthService
from backend.app.services.oauth_service import OAuthService
from backend.app.services.password_cipher_service import PasswordCipherService

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


def _is_desktop_deep_link(url: str) -> bool:
    protocol = get_settings().desktop_oauth_redirect_uri.split("://", 1)[0]
    return url.startswith(f"{protocol}://")


def _desktop_oauth_bridge_html(deep_link: str) -> str:
    """Browsers often ignore bare 307 redirects to custom protocols; open via HTML."""
    from urllib.parse import parse_qs, urlparse

    parsed = urlparse(deep_link)
    query = parse_qs(parsed.query)
    error_param = query.get("error")
    error = error_param[0] if error_param else None
    safe = (
        deep_link.replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace('"', "&quot;")
    )
    if error:
        title = "Sign-in failed"
        body = "Authorization did not complete. You can close this tab and try again in the app."
        button = "Back to Cloud Travel Guide"
    else:
        title = "Sign-in complete"
        body = "Returning you to the Cloud Travel Guide desktop app…"
        button = "Open Cloud Travel Guide"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <style>
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: system-ui, sans-serif;
      background: #0b1220;
      color: #e8eefc;
    }}
    main {{
      max-width: 28rem;
      padding: 2rem;
      text-align: center;
    }}
    a {{
      display: inline-block;
      margin-top: 1rem;
      padding: 0.75rem 1.25rem;
      border-radius: 0.5rem;
      background: #3b82f6;
      color: white;
      text-decoration: none;
      font: inherit;
    }}
    p {{ opacity: 0.85; line-height: 1.5; }}
  </style>
</head>
<body>
  <main>
    <h1>{title}</h1>
    <p>{body}</p>
    <p>If the app does not open automatically, click the button below.</p>
    <p><a id="open-app" href="{safe}">{button}</a></p>
  </main>
  <script>
    (function () {{
      var link = '{safe}';
      try {{ window.location.replace(link); }} catch (e) {{}}
      setTimeout(function () {{
        try {{ window.location.href = link; }} catch (e) {{}}
      }}, 400);
    }})();
  </script>
</body>
</html>
"""


@router.get("/password-key", response_model_by_alias=True)
def password_key(
    cipher_service: Annotated[PasswordCipherService, Depends(get_password_cipher_service)],
) -> PasswordKeyResponse:
    return cipher_service.get_public_key_material()


@router.post("/login")
def login(
    payload: LoginRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
    cipher_service: Annotated[PasswordCipherService, Depends(get_password_cipher_service)],
) -> TokenResponse:
    password = cipher_service.decrypt_password(payload.password_envelope)
    return auth_service.login(username=payload.username, password=password)


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
    payload: RegisterRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
    cipher_service: Annotated[PasswordCipherService, Depends(get_password_cipher_service)],
) -> MessageResponse:
    password = cipher_service.decrypt_register_password(payload.password_envelope)
    auth_service.register(username=payload.username, password=password)
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


@router.get("/oauth/{provider}/callback", response_model=None)
async def oauth_callback(
    provider: OAuthProvider,
    code: Annotated[str, Query()],
    state: Annotated[str, Query()],
    oauth_service: Annotated[OAuthService, Depends(get_oauth_service)],
) -> Response:
    target, token = await oauth_service.handle_callback(provider=provider, code=code, state=state)

    # Desktop: custom-protocol 307 is unreliable in Chromium — serve a bridge page.
    if _is_desktop_deep_link(target):
        return HTMLResponse(content=_desktop_oauth_bridge_html(target), status_code=200)

    response = RedirectResponse(url=target, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    if token is not None:
        # Optional same-origin cookie; web callback primarily uses the one-time code.
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
