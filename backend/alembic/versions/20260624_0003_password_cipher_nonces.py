"""add password cipher nonces

Revision ID: 20260624_0003
Revises: 20260623_0002
Create Date: 2026-06-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260624_0003"
down_revision: str | Sequence[str] | None = "20260623_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "password_cipher_nonces",
        sa.Column("nonce", sa.String(length=36), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("nonce"),
    )
    op.create_index(
        "ix_password_cipher_nonces_expires_at",
        "password_cipher_nonces",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_password_cipher_nonces_expires_at", table_name="password_cipher_nonces")
    op.drop_table("password_cipher_nonces")
