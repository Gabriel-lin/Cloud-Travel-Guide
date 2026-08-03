from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from backend.app.core.config import AUTH_COOKIE_NAME
from backend.app.core.database import get_db
from backend.app.core.exceptions import UnauthorizedError
from backend.app.models.user import User
from backend.app.services.auth_service import AuthService
from backend.app.services.oauth_service import OAuthService
from backend.app.services.password_cipher_service import PasswordCipherService
from backend.app.services.plan_chat_service import PlanChatService
from backend.app.services.plan_chat_thread_service import PlanChatThreadService
from backend.app.services.plan_service import PlanService

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


def get_auth_service(db: Annotated[Session, Depends(get_db)]) -> AuthService:
    return AuthService(db)


def get_oauth_service(db: Annotated[Session, Depends(get_db)]) -> OAuthService:
    return OAuthService(db)


def get_password_cipher_service(
    db: Annotated[Session, Depends(get_db)],
) -> PasswordCipherService:
    return PasswordCipherService(db)


def get_plan_chat_service() -> PlanChatService:
    return PlanChatService()


def get_plan_service(db: Annotated[Session, Depends(get_db)]) -> PlanService:
    return PlanService(db)


def get_plan_chat_thread_service(
    db: Annotated[Session, Depends(get_db)],
) -> PlanChatThreadService:
    return PlanChatThreadService(db)


def get_current_token(
    request: Request,
    bearer_token: Annotated[str | None, Depends(oauth2_scheme)],
) -> str:
    token = bearer_token or request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        raise UnauthorizedError()
    return token


def get_current_user(
    token: Annotated[str, Depends(get_current_token)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> User:
    return auth_service.get_current_user(token)
