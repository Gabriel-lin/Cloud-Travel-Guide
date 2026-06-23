"""add oauth login codes

Revision ID: 20260623_0002
Revises: 20260316_0001
Create Date: 2026-06-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260623_0002"
down_revision: str | Sequence[str] | None = "20260316_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "oauth_login_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index("ix_oauth_login_codes_code_hash", "oauth_login_codes", ["code_hash"])
    op.create_index("ix_oauth_login_codes_expires_at", "oauth_login_codes", ["expires_at"])
    op.create_index("ix_oauth_login_codes_user_id", "oauth_login_codes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_oauth_login_codes_user_id", table_name="oauth_login_codes")
    op.drop_index("ix_oauth_login_codes_expires_at", table_name="oauth_login_codes")
    op.drop_index("ix_oauth_login_codes_code_hash", table_name="oauth_login_codes")
    op.drop_table("oauth_login_codes")
