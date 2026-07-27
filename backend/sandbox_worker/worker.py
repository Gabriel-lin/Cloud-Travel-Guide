"""Sandbox worker — claim queued agent_jobs and execute in Docker."""

from __future__ import annotations

import logging
import os
import signal
import socket
import sys
import time
import uuid
from collections.abc import Callable

from backend.app.core.config import get_settings
from backend.app.core.database import SessionLocal
from backend.app.services.agent_job_service import AgentJobService
from backend.sandbox_worker.docker_runner import DockerSandboxRunner

logger = logging.getLogger(__name__)

_shutdown = False
_WORKER_ID = f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"


def _handle_signal(signum: int, _frame: object) -> None:
    global _shutdown
    logger.info("received signal %s — shutting down after current job", signum)
    _shutdown = True


def _with_fresh_session[T](fn: Callable[[AgentJobService], T]) -> T:
    """Open a short-lived Session for callbacks that may run off the main thread."""
    db = SessionLocal()
    try:
        return fn(AgentJobService(db))
    finally:
        db.close()


def process_one(service: AgentJobService, runner: DockerSandboxRunner) -> bool:
    """Claim and run one job. Returns True if a job was processed."""
    orphans = service.reclaim_stale_leases()
    if orphans:
        runner.kill_containers(orphans)

    job = service.claim_next(worker_id=_WORKER_ID)
    if job is None:
        return False

    payload = job.payload or {}
    language = str(payload.get("language") or "python")
    script = str(payload.get("script") or "")
    profile = str(payload.get("profile") or "default")
    job_id = str(job.id)
    job_uuid = job.id

    logger.info(
        "claimed job=%s lang=%s profile=%s timeout=%s",
        job_id,
        language,
        profile,
        job.timeout_sec,
    )
    service.set_progress(job.id, message="Starting container", percent=10)

    service._db.refresh(job)
    if job.status == "cancelled":
        service.mark_finished(job, status="cancelled", error_message="Cancelled before start")
        return True

    def cancel_check() -> bool:
        return _with_fresh_session(lambda s: s.is_cancelled(job_uuid))

    def heartbeat() -> bool:
        return _with_fresh_session(lambda s: s.heartbeat_lease(job_uuid, worker_id=_WORKER_ID))

    def on_container_id(cid: str) -> None:
        _with_fresh_session(lambda s: s.set_container_id(job_uuid, cid))

    try:
        result = runner.run_job(
            job_id=job_id,
            language=language,
            script=script,
            profile=profile,
            timeout_sec=job.timeout_sec,
            cancel_check=cancel_check,
            on_container_id=on_container_id,
            heartbeat=heartbeat,
        )
    except Exception as exc:
        logger.exception("job=%s failed", job_id)
        service._db.refresh(job)
        if job.status == "cancelled":
            service.mark_finished(job, status="cancelled", error_message="Cancelled")
            return True
        service.mark_finished(
            job,
            status="failed",
            error_message=str(exc),
            result={"error": str(exc)},
        )
        return True

    service._db.refresh(job)
    if result.cancelled or job.status == "cancelled":
        service.mark_finished(
            job,
            status="cancelled",
            result={
                "exitCode": result.exit_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "artifacts": result.artifact_paths,
                "containerId": result.container_id,
            },
            error_message="Cancelled",
        )
        return True

    if result.timed_out:
        status = "timed_out"
    elif result.exit_code == 0:
        status = "succeeded"
    else:
        status = "failed"

    service.mark_finished(
        job,
        status=status,
        result={
            "exitCode": result.exit_code,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "artifacts": result.artifact_paths,
            "containerId": result.container_id,
        },
        error_message=None
        if status == "succeeded"
        else (result.stderr or f"exit {result.exit_code}"),
    )
    logger.info("finished job=%s status=%s", job_id, status)
    return True


def run_forever() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [sandbox-worker] %(message)s",
    )
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    settings = get_settings()
    runner = DockerSandboxRunner()
    poll = settings.sandbox_worker_poll_sec
    logger.info(
        "starting sandbox-worker id=%s runtime=%s poll=%ss workspace=%s volume=%s docker_host=%s",
        _WORKER_ID,
        settings.sandbox_runtime,
        poll,
        settings.agent_workspace_dir,
        settings.sandbox_workspace_volume,
        os.environ.get("DOCKER_HOST", "(default)"),
    )
    try:
        DockerSandboxRunner.ensure_default_images()
        logger.info("sandbox images ready")
    except Exception:
        logger.exception("sandbox image bootstrap failed; jobs may fail until images are pulled")

    while not _shutdown:
        db = SessionLocal()
        try:
            service = AgentJobService(db)
            processed = process_one(service, runner)
        except Exception:
            logger.exception("worker loop error")
            processed = False
        finally:
            db.close()

        if not processed:
            deadline = time.monotonic() + poll
            while not _shutdown and time.monotonic() < deadline:
                time.sleep(min(0.25, deadline - time.monotonic()))


def main() -> None:
    try:
        run_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
