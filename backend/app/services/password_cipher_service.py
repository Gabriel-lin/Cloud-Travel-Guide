from __future__ import annotations

from sqlalchemy.orm import Session

from backend.app.core.exceptions import BadRequestError
from backend.app.core.password_policy import validate_register_password
from backend.app.core.password_transport import (
    get_password_transport_keys,
    open_password_envelope,
)
from backend.app.repositories.password_cipher_nonce_repository import (
    PasswordCipherNonceRepository,
)
from backend.app.schemas.auth import PasswordEnvelope, PasswordKeyResponse


class PasswordCipherService:
    def __init__(self, db: Session) -> None:
        self._nonces = PasswordCipherNonceRepository(db)

    def get_public_key_material(self) -> PasswordKeyResponse:
        keys = get_password_transport_keys()
        return PasswordKeyResponse(
            key_id=keys.key_id,
            public_key=keys.public_key_pem,
            algorithm="RSA-OAEP-256",
            cipher_suite="AES-GCM",
        )

    def decrypt_password(self, envelope: PasswordEnvelope) -> str:
        keys = get_password_transport_keys()
        password, nonce, expires_at = open_password_envelope(
            envelope.model_dump(),
            expected_key_id=keys.key_id,
        )
        if not self._nonces.consume(nonce=nonce, expires_at=expires_at):
            raise BadRequestError("Password envelope has already been used")
        return password

    def decrypt_register_password(self, envelope: PasswordEnvelope) -> str:
        password = self.decrypt_password(envelope)
        try:
            return validate_register_password(password)
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc
