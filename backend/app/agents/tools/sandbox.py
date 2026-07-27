"""Sandbox job tools — enqueue / poll / cancel via AgentJobService."""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any, Literal

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.context import emit_progress, get_agent_context
from backend.app.agents.tools.base import dumps_json
from backend.app.core.config import get_settings
from backend.app.core.exceptions import AppError
from backend.app.services.agent_job_service import TERMINAL_STATUSES, AgentJobService
from backend.sandbox_worker.profiles import normalize_sandbox_profile

Lang = Literal["python", "bash"]
SandboxProfile = Literal["default", "playwright"]


class RunSandboxInput(BaseModel):
    language: Lang = Field(default="python", description="python or bash")
    script: str = Field(description="Script source to run inside the sandbox")
    profile: SandboxProfile = Field(
        default="default",
        description=(
            "Sandbox template: default (Code Interpreter Lite) or playwright "
            "(Chromium for pixel-accurate HTML/PDF; import html_to_pdf from bundled tools)."
        ),
    )
    timeout_sec: int | None = Field(
        default=None,
        ge=5,
        le=3600,
        description="Job wall-clock timeout (seconds)",
    )


class JobIdInput(BaseModel):
    job_id: str = Field(alias="jobId", description="Sandbox job UUID")

    model_config = {"populate_by_name": True}


def _require_user_db() -> tuple[uuid.UUID, Any]:
    ctx = get_agent_context()
    if ctx.user_id is None or ctx.db is None:
        raise RuntimeError("Sandbox tools require an authenticated chat session")
    return ctx.user_id, ctx.db


def _validate_script(script: str) -> str | None:
    settings = get_settings()
    if not script or not script.strip():
        return "script is empty"
    if len(script.encode("utf-8")) > settings.sandbox_max_script_bytes:
        return f"script exceeds {settings.sandbox_max_script_bytes} bytes"
    return None


async def _run_sandbox_job_async(
    language: str = "python",
    script: str = "",
    timeout_sec: int | None = None,
    profile: str = "default",
) -> str:
    ctx = get_agent_context()
    user_id, db = _require_user_db()
    err = _validate_script(script)
    if err:
        return dumps_json({"ok": False, "error": err})

    settings = get_settings()
    if language not in {"python", "bash"}:
        return dumps_json({"ok": False, "error": "language must be python or bash"})
    try:
        normalized_profile = normalize_sandbox_profile(profile)
    except ValueError as exc:
        return dumps_json({"ok": False, "error": str(exc)})

    service = AgentJobService(db)
    try:
        job = service.enqueue(
            user_id=user_id,
            payload={
                "language": language,
                "script": script,
                "profile": normalized_profile,
            },
            agent_id=ctx.agent_id,
            thread_id=ctx.thread_id,
            plan_id=ctx.plan_id,
            timeout_sec=timeout_sec,
        )
    except AppError as exc:
        return dumps_json({"ok": False, "error": str(exc), "code": exc.code})

    await emit_progress(
        {
            "type": "job_progress",
            "jobId": str(job.id),
            "status": job.status,
            "message": "queued",
            "percent": 0,
        }
    )

    wait_deadline = time.monotonic() + settings.sandbox_tool_wait_sec
    poll_sec = settings.sandbox_poll_interval_sec
    last_status = job.status
    last_msg = job.progress_message

    while time.monotonic() < wait_deadline:
        await asyncio.sleep(poll_sec)
        db.refresh(job)
        if job.status != last_status or job.progress_message != last_msg:
            last_status = job.status
            last_msg = job.progress_message
            await emit_progress(
                {
                    "type": "job_progress",
                    "jobId": str(job.id),
                    "status": job.status,
                    "message": job.progress_message,
                    "percent": job.progress_percent,
                }
            )
        if job.status in TERMINAL_STATUSES:
            return dumps_json({"ok": True, **service.to_public(job)})

    return dumps_json(
        {
            "ok": True,
            "timedOutWaiting": True,
            "message": "Still running; use get_sandbox_job to continue polling",
            **service.to_public(job),
        }
    )


def _run_sandbox_job(
    language: str = "python",
    script: str = "",
    timeout_sec: int | None = None,
    profile: str = "default",
) -> str:
    """Sync entry — LangGraph prefers `coroutine` when present."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(_run_sandbox_job_async(language, script, timeout_sec, profile))
    # Called from an async context without awaiting coroutine= — fall back to thread.
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(
            asyncio.run,
            _run_sandbox_job_async(language, script, timeout_sec, profile),
        ).result()


def _get_sandbox_job(job_id: str) -> str:
    user_id, db = _require_user_db()
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        return dumps_json({"ok": False, "error": "invalid jobId"})
    service = AgentJobService(db)
    try:
        job = service.get_for_user(jid, user_id)
    except Exception as exc:
        return dumps_json({"ok": False, "error": str(exc)})
    return dumps_json({"ok": True, **service.to_public(job)})


def _cancel_sandbox_job(job_id: str) -> str:
    user_id, db = _require_user_db()
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        return dumps_json({"ok": False, "error": "invalid jobId"})
    service = AgentJobService(db)
    try:
        job = service.request_cancel(jid, user_id)
    except Exception as exc:
        return dumps_json({"ok": False, "error": str(exc)})
    return dumps_json({"ok": True, **service.to_public(job)})


def build_run_sandbox_job_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="run_sandbox_job",
        description=(
            "Enqueue a python/bash script in the Docker sandbox, wait for completion "
            "(or until wait timeout), and return status/artifacts. Emits job_progress events. "
            "Profiles: default (data/viz/weasyprint) or playwright (Chromium PDF). "
            "For simple MD→PDF prefer convert_markdown_to_pdf."
        ),
        func=_run_sandbox_job,
        coroutine=_run_sandbox_job_async,
        args_schema=RunSandboxInput,
    )


def build_get_sandbox_job_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="get_sandbox_job",
        description="Look up a sandbox job by id (for continuing after wait timeout).",
        func=_get_sandbox_job,
        args_schema=JobIdInput,
    )


def build_cancel_sandbox_job_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="cancel_sandbox_job",
        description="Request cancellation of a sandbox job owned by the current user.",
        func=_cancel_sandbox_job,
        args_schema=JobIdInput,
    )
