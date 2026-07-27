"""add agent_jobs + travel_plans.itinerary

Revision ID: 20260720_0005
Revises: 20260716_0004
Create Date: 2026-07-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260720_0005"
down_revision: str | Sequence[str] | None = "20260716_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "travel_plans",
        sa.Column(
            "itinerary",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=True,
        ),
    )
    op.create_table(
        "agent_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.String(length=64), nullable=True),
        sa.Column("thread_id", sa.String(length=128), nullable=True),
        sa.Column("plan_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="queued", nullable=False),
        sa.Column(
            "payload",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "result",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=True,
        ),
        sa.Column("progress_message", sa.Text(), nullable=True),
        sa.Column("progress_percent", sa.Integer(), nullable=True),
        sa.Column("timeout_sec", sa.Integer(), server_default="600", nullable=False),
        sa.Column("container_id", sa.String(length=128), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_jobs_user_id", "agent_jobs", ["user_id"])
    op.create_index("ix_agent_jobs_plan_id", "agent_jobs", ["plan_id"])
    op.create_index("ix_agent_jobs_status", "agent_jobs", ["status"])
    op.create_index(
        "ix_agent_jobs_status_created",
        "agent_jobs",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_jobs_status_created", table_name="agent_jobs")
    op.drop_index("ix_agent_jobs_status", table_name="agent_jobs")
    op.drop_index("ix_agent_jobs_plan_id", table_name="agent_jobs")
    op.drop_index("ix_agent_jobs_user_id", table_name="agent_jobs")
    op.drop_table("agent_jobs")
    op.drop_column("travel_plans", "itinerary")
