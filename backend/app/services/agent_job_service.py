"""Postgres-backed sandbox job queue with lease reclaim."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.core.exceptions import AppError, NotFoundError
from backend.app.models.agent_job import AgentJob

logger = logging.getLogger(__name__)

TERMINAL_STATUSES = frozenset({"succeeded", "failed", "cancelled", "timed_out"})
ACTIVE_STATUSES = frozenset({"queued", "running"})


class AgentJobService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def enqueue(
        self,
        *,
        user_id: uuid.UUID,
        payload: dict[str, Any],
        agent_id: str | None = None,
        thread_id: str | None = None,
        plan_id: uuid.UUID | None = None,
        timeout_sec: int | None = None,
    ) -> AgentJob:
        settings = get_settings()
        self._enforce_user_limits(user_id)

        job = AgentJob(
            id=uuid.uuid4(),
            user_id=user_id,
            agent_id=agent_id,
            thread_id=thread_id,
            plan_id=plan_id,
            status="queued",
            payload=payload,
            timeout_sec=timeout_sec or settings.sandbox_job_timeout_sec,
        )
        self._db.add(job)
        self._db.commit()
        self._db.refresh(job)
        logger.info("enqueued agent_job id=%s user=%s", job.id, user_id)
        return job

    def get_for_user(self, job_id: uuid.UUID, user_id: uuid.UUID) -> AgentJob:
        job = self._db.get(AgentJob, job_id)
        if job is None or job.user_id != user_id:
            raise NotFoundError("Job not found")
        return job

    def request_cancel(self, job_id: uuid.UUID, user_id: uuid.UUID) -> AgentJob:
        """Mark job cancelled. Running containers are killed by the worker cancel poll."""
        job = self.get_for_user(job_id, user_id)
        if job.status in TERMINAL_STATUSES:
            return job
        job.status = "cancelled"
        job.progress_message = "Cancellation requested"
        job.finished_at = datetime.now(UTC)
        job.lease_owner = None
        job.lease_expires_at = None
        self._db.commit()
        self._db.refresh(job)
        return job

    def set_progress(
        self,
        job_id: uuid.UUID,
        *,
        message: str | None = None,
        percent: int | None = None,
    ) -> None:
        values: dict[str, Any] = {}
        if message is not None:
            values["progress_message"] = message
        if percent is not None:
            values["progress_percent"] = percent
        if not values:
            return
        self._db.execute(update(AgentJob).where(AgentJob.id == job_id).values(**values))
        self._db.commit()

    def set_container_id(self, job_id: uuid.UUID, container_id: str) -> None:
        self._db.execute(
            update(AgentJob)
            .where(AgentJob.id == job_id)
            .values(container_id=container_id, progress_message="Running")
        )
        self._db.commit()

    def mark_finished(
        self,
        job: AgentJob,
        *,
        status: str,
        result: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> AgentJob:
        job.status = status
        job.result = result
        job.error_message = error_message
        job.finished_at = datetime.now(UTC)
        job.lease_owner = None
        job.lease_expires_at = None
        if status == "succeeded":
            job.progress_percent = 100
            job.progress_message = "Succeeded"
        self._db.commit()
        self._db.refresh(job)
        return job

    def reclaim_stale_leases(self) -> list[str]:
        """Requeue expired running jobs.

        Returns Docker container IDs that must be force-killed (orphans from dead workers).
        """
        now = datetime.now(UTC)
        bind = self._db.get_bind()
        dialect = bind.dialect.name if bind is not None else ""
        orphan_ids: list[str] = []

        if dialect == "postgresql":
            rows = self._db.execute(
                text(
                    """
                    SELECT id, container_id FROM agent_jobs
                    WHERE status = 'running'
                      AND lease_expires_at IS NOT NULL
                      AND lease_expires_at < :now
                    FOR UPDATE SKIP LOCKED
                    """
                ),
                {"now": now},
            ).all()
            for row in rows:
                job_id, container_id = row[0], row[1]
                if container_id:
                    orphan_ids.append(container_id)
                self._db.execute(
                    text(
                        """
                        UPDATE agent_jobs
                        SET status = 'queued',
                            lease_owner = NULL,
                            lease_expires_at = NULL,
                            container_id = NULL,
                            started_at = NULL,
                            progress_message = 'Reclaimed stale lease',
                            progress_percent = NULL
                        WHERE id = :id
                        """
                    ),
                    {"id": job_id},
                )
            self._db.commit()
            return orphan_ids

        jobs = self._db.scalars(
            select(AgentJob).where(
                AgentJob.status == "running",
                AgentJob.lease_expires_at.is_not(None),
                AgentJob.lease_expires_at < now,
            )
        ).all()
        for job in jobs:
            if job.container_id:
                orphan_ids.append(job.container_id)
            job.status = "queued"
            job.lease_owner = None
            job.lease_expires_at = None
            job.container_id = None
            job.started_at = None
            job.progress_message = "Reclaimed stale lease"
            job.progress_percent = None
        self._db.commit()
        return orphan_ids

    def claim_next(self, *, worker_id: str | None = None) -> AgentJob | None:
        """Claim one queued job using FOR UPDATE SKIP LOCKED (Postgres).

        Callers should run reclaim_stale_leases() + kill orphans before claiming.
        """
        settings = get_settings()
        owner = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        lease_until = datetime.now(UTC) + timedelta(seconds=settings.sandbox_job_lease_sec)

        bind = self._db.get_bind()
        dialect = bind.dialect.name if bind is not None else ""

        if dialect == "postgresql":
            row = self._db.execute(
                text(
                    """
                    SELECT id FROM agent_jobs
                    WHERE status = 'queued'
                    ORDER BY created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                    """
                )
            ).first()
            if row is None:
                return None
            job = self._db.get(AgentJob, row[0])
        else:
            job = self._db.scalar(
                select(AgentJob)
                .where(AgentJob.status == "queued")
                .order_by(AgentJob.created_at.asc())
                .limit(1)
                .with_for_update()
            )
            if job is None:
                return None

        if job is None or job.status == "cancelled":
            return None

        job.status = "running"
        job.started_at = datetime.now(UTC)
        job.progress_message = "Claimed by worker"
        job.lease_owner = owner
        job.lease_expires_at = lease_until
        self._db.commit()
        self._db.refresh(job)
        return job

    def heartbeat_lease(self, job_id: uuid.UUID, *, worker_id: str) -> bool:
        """Extend lease if still owned and not cancelled. Returns False if should stop."""
        settings = get_settings()
        job = self._db.get(AgentJob, job_id)
        if job is None:
            return False
        if job.status == "cancelled":
            return False
        if job.status != "running":
            return False
        if job.lease_owner and job.lease_owner != worker_id:
            return False
        job.lease_expires_at = datetime.now(UTC) + timedelta(seconds=settings.sandbox_job_lease_sec)
        self._db.commit()
        return True

    def is_cancelled(self, job_id: uuid.UUID) -> bool:
        job = self._db.get(AgentJob, job_id)
        return job is not None and job.status == "cancelled"

    def to_public(self, job: AgentJob) -> dict[str, Any]:
        return {
            "jobId": str(job.id),
            "status": job.status,
            "progressMessage": job.progress_message,
            "progressPercent": job.progress_percent,
            "result": job.result,
            "errorMessage": job.error_message,
            "createdAt": job.created_at.isoformat() if job.created_at else None,
            "startedAt": job.started_at.isoformat() if job.started_at else None,
            "finishedAt": job.finished_at.isoformat() if job.finished_at else None,
        }

    def _enforce_user_limits(self, user_id: uuid.UUID) -> None:
        from sqlalchemy import func

        settings = get_settings()
        count = self._db.scalar(
            select(func.count())
            .select_from(AgentJob)
            .where(AgentJob.user_id == user_id, AgentJob.status.in_(tuple(ACTIVE_STATUSES)))
        )
        if (count or 0) >= settings.sandbox_max_concurrent_jobs_per_user:
            raise AppError(
                "Too many concurrent sandbox jobs",
                status_code=429,
                code="sandbox_concurrency_limit",
            )
