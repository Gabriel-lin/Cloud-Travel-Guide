from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.oauth_account import OAuthAccount
from backend.app.models.token_blacklist import TokenBlacklist
from backend.app.models.user import User


class UserRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return self._db.get(User, user_id)

    def get_by_username(self, username: str) -> User | None:
        return self._db.scalar(select(User).where(User.username == username))

    def get_by_email(self, email: str) -> User | None:
        return self._db.scalar(select(User).where(User.email == email))

    def username_exists(self, username: str) -> bool:
        return self.get_by_username(username) is not None

    def add(self, user: User) -> User:
        self._db.add(user)
        self._db.commit()
        self._db.refresh(user)
        return user

    def save(self, user: User) -> User:
        self._db.commit()
        self._db.refresh(user)
        return user


class TokenRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def is_blacklisted(self, jti: str) -> bool:
        return self._db.scalar(select(TokenBlacklist).where(TokenBlacklist.jti == jti)) is not None

    def blacklist(self, *, jti: str, expires_at: datetime) -> None:
        self._db.add(TokenBlacklist(jti=jti, expires_at=expires_at))
        self._db.commit()


class OAuthRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_account(self, *, provider: str, provider_user_id: str) -> OAuthAccount | None:
        return self._db.scalar(
            select(OAuthAccount).where(
                OAuthAccount.provider == provider,
                OAuthAccount.provider_user_id == provider_user_id,
            )
        )

    def get_accounts_by_user_id(self, user_id: uuid.UUID) -> list[OAuthAccount]:
        return list(self._db.scalars(select(OAuthAccount).where(OAuthAccount.user_id == user_id)))

    def add_account(self, account: OAuthAccount) -> OAuthAccount:
        self._db.add(account)
        self._db.commit()
        self._db.refresh(account)
        return account

    def save(self) -> None:
        self._db.commit()
