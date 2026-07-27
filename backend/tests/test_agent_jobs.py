"""Unit tests for AgentJobService claim + plan tool auth guards."""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-with-at-least-32-bytes")

from backend.app.agents.context import AgentRunContext, clear_agent_context, set_agent_context
from backend.app.agents.tools.plan_entity import _get_current_plan
from backend.app.core.database import Base
from backend.app.models.agent_job import AgentJob  # noqa: F401 — register metadata
from backend.app.models.user import User
from backend.app.services.agent_job_service import AgentJobService


@pytest.fixture
def db() -> Session:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def _user(db: Session) -> User:
    user = User(id=uuid.uuid4(), username=f"u_{uuid.uuid4().hex[:8]}", password_hash="x")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_claim_jobs_are_not_double_consumed(db: Session) -> None:
    user = _user(db)
    svc = AgentJobService(db)
    j1 = svc.enqueue(user_id=user.id, payload={"language": "python", "script": "print(1)"})
    j2 = svc.enqueue(user_id=user.id, payload={"language": "python", "script": "print(2)"})

    claimed_a = svc.claim_next()
    claimed_b = svc.claim_next()
    claimed_c = svc.claim_next()

    assert claimed_a is not None
    assert claimed_b is not None
    assert claimed_c is None
    assert {claimed_a.id, claimed_b.id} == {j1.id, j2.id}
    assert claimed_a.status == "running"
    assert claimed_b.status == "running"


def test_plan_tool_requires_plan_id(db: Session) -> None:
    user = _user(db)
    set_agent_context(AgentRunContext(user_id=user.id, db=db, plan_id=None))
    try:
        raw = _get_current_plan()
        assert "No planId" in raw or '"ok": false' in raw.lower() or '"ok":false' in raw
    finally:
        clear_agent_context()


def test_enqueue_respects_concurrency_limit(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app.core.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("SANDBOX_MAX_CONCURRENT_JOBS_PER_USER", "1")
    get_settings.cache_clear()

    user = _user(db)
    svc = AgentJobService(db)
    svc.enqueue(user_id=user.id, payload={"language": "python", "script": "print(1)"})

    from backend.app.core.exceptions import AppError

    with pytest.raises(AppError) as exc:
        svc.enqueue(user_id=user.id, payload={"language": "python", "script": "print(2)"})
    assert exc.value.code == "sandbox_concurrency_limit"

    get_settings.cache_clear()


def test_reclaim_stale_lease_returns_orphan_container_ids(db: Session) -> None:
    from datetime import UTC, datetime, timedelta

    user = _user(db)
    svc = AgentJobService(db)
    job = svc.enqueue(user_id=user.id, payload={"language": "python", "script": "print(1)"})
    claimed = svc.claim_next(worker_id="worker-a")
    assert claimed is not None
    assert claimed.id == job.id
    assert claimed.status == "running"
    assert claimed.lease_owner == "worker-a"

    svc.set_container_id(claimed.id, "deadbeefcontainer")
    claimed.lease_expires_at = datetime.now(UTC) - timedelta(seconds=5)
    db.commit()

    orphans = svc.reclaim_stale_leases()
    assert orphans == ["deadbeefcontainer"]
    db.refresh(job)
    assert job.status == "queued"
    assert job.lease_owner is None
    assert job.container_id is None

    again = svc.claim_next(worker_id="worker-b")
    assert again is not None
    assert again.id == job.id
    assert again.lease_owner == "worker-b"


def test_request_cancel_marks_queued_job_cancelled(db: Session) -> None:
    user = _user(db)
    svc = AgentJobService(db)
    job = svc.enqueue(user_id=user.id, payload={"language": "python", "script": "print(1)"})
    cancelled = svc.request_cancel(job.id, user.id)
    assert cancelled.status == "cancelled"
    assert cancelled.finished_at is not None
    assert svc.claim_next(worker_id="worker-a") is None


def test_request_cancel_running_job_sets_finished_at(db: Session) -> None:
    user = _user(db)
    svc = AgentJobService(db)
    svc.enqueue(user_id=user.id, payload={"language": "python", "script": "print(1)"})
    claimed = svc.claim_next(worker_id="worker-a")
    assert claimed is not None
    svc.set_container_id(claimed.id, "abc123")
    cancelled = svc.request_cancel(claimed.id, user.id)
    assert cancelled.status == "cancelled"
    assert cancelled.finished_at is not None
    assert svc.is_cancelled(claimed.id) is True
