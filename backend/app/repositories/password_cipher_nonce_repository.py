from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.models.password_cipher_nonce import PasswordCipherNonce


class PasswordCipherNonceRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def consume(self, *, nonce: str, expires_at: datetime) -> bool:
        existing = self._db.get(PasswordCipherNonce, nonce)
        if existing is not None:
            return False

        self._db.add(PasswordCipherNonce(nonce=nonce, expires_at=expires_at))
        try:
            self._db.commit()
            return True
        except IntegrityError:
            self._db.rollback()
            return False

    def purge_expired(self, *, now: datetime) -> None:
        expired = self._db.scalars(
            select(PasswordCipherNonce).where(PasswordCipherNonce.expires_at < now)
        )
        for row in expired:
            self._db.delete(row)
        self._db.commit()
