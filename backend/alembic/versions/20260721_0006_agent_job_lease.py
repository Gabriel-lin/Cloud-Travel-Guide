"""add agent_jobs lease columns for reclaim

Revision ID: 20260721_0006
Revises: 20260720_0005
Create Date: 2026-07-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260721_0006"
down_revision: str | Sequence[str] | None = "20260720_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agent_jobs", sa.Column("lease_owner", sa.String(length=128), nullable=True))
    op.add_column(
        "agent_jobs",
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agent_jobs_lease_expires_at", "agent_jobs", ["lease_expires_at"])


def downgrade() -> None:
    op.drop_index("ix_agent_jobs_lease_expires_at", table_name="agent_jobs")
    op.drop_column("agent_jobs", "lease_expires_at")
    op.drop_column("agent_jobs", "lease_owner")
