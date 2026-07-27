"""Plan entity tools — read/update user TravelPlan via PlanService."""

from __future__ import annotations

import asyncio
import uuid
from datetime import date
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.context import emit_progress, get_agent_context
from backend.app.agents.tools.base import dumps_json
from backend.app.schemas.plan import PlanDestination, UpdatePlanRequest
from backend.app.services.plan_service import PlanService

# Keep strong refs so create_task isn't GC'd (RUF006)
_background_tasks: set[asyncio.Task[None]] = set()


def _schedule_progress(payload: dict[str, Any]) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(emit_progress(payload))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _require_user_db() -> tuple[uuid.UUID, Any]:
    ctx = get_agent_context()
    if ctx.user_id is None or ctx.db is None:
        raise RuntimeError("Plan tools require an authenticated chat session")
    return ctx.user_id, ctx.db


def _user_stub(user_id: uuid.UUID) -> Any:
    """Minimal user-like object for PlanService (only `.id` is used)."""

    class _U:
        id = user_id

    return _U()


class EmptyInput(BaseModel):
    pass


class ListPlansInput(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=10, ge=1, le=50, alias="pageSize")

    model_config = {"populate_by_name": True}


class UpdatePlanFieldsInput(BaseModel):
    title: str | None = None
    description: str | None = None
    start_date: date | None = Field(default=None, alias="startDate")
    end_date: date | None = Field(default=None, alias="endDate")
    destinations: list[dict[str, Any]] | None = None

    model_config = {"populate_by_name": True}


class ApplyItineraryDraftInput(BaseModel):
    draft_markdown: str = Field(description="Structured itinerary text to store on the plan")
    title: str | None = Field(default=None, description="Optional new title")


def _get_current_plan() -> str:
    ctx = get_agent_context()
    user_id, db = _require_user_db()
    if ctx.plan_id is None:
        return dumps_json(
            {
                "ok": False,
                "error": "No planId bound to this chat. Ask the user to select/create a plan.",
            }
        )
    service = PlanService(db)
    try:
        detail = service.get_plan(_user_stub(user_id), ctx.plan_id)
    except Exception as exc:
        return dumps_json({"ok": False, "error": str(exc)})
    return dumps_json({"ok": True, "plan": detail.model_dump(by_alias=True, mode="json")})


def _list_my_plans(page: int = 1, page_size: int = 10) -> str:
    user_id, db = _require_user_db()
    service = PlanService(db)
    result = service.list_plans(_user_stub(user_id), page=page, page_size=page_size)
    return dumps_json({"ok": True, "plans": result.model_dump(by_alias=True, mode="json")})


def _update_plan_fields(
    title: str | None = None,
    description: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    destinations: list[dict[str, Any]] | None = None,
) -> str:
    ctx = get_agent_context()
    user_id, db = _require_user_db()
    if ctx.plan_id is None:
        return dumps_json({"ok": False, "error": "No planId bound to this chat"})

    dest_models: list[PlanDestination] | None = None
    if destinations is not None:
        dest_models = [PlanDestination.model_validate(d) for d in destinations]

    body = UpdatePlanRequest(
        title=title,
        description=description,
        start_date=start_date,
        end_date=end_date,
        destinations=dest_models,
    )
    service = PlanService(db)
    try:
        detail = service.update_plan(_user_stub(user_id), ctx.plan_id, body)
    except Exception as exc:
        return dumps_json({"ok": False, "error": str(exc)})

    _schedule_progress(
        {
            "type": "plan_updated",
            "planId": str(ctx.plan_id),
            "summary": detail.title,
        }
    )

    return dumps_json({"ok": True, "plan": detail.model_dump(by_alias=True, mode="json")})


def _apply_itinerary_draft(draft_markdown: str, title: str | None = None) -> str:
    ctx = get_agent_context()
    user_id, db = _require_user_db()
    if ctx.plan_id is None:
        return dumps_json({"ok": False, "error": "No planId bound to this chat"})

    service = PlanService(db)
    plan = service._repo.get_by_id_for_user(ctx.plan_id, user_id)
    if plan is None:
        return dumps_json({"ok": False, "error": "Plan not found"})

    # Prefer itinerary JSONB when present; always keep markdown in description too.
    plan.description = draft_markdown
    if hasattr(plan, "itinerary"):
        plan.itinerary = {"format": "markdown", "content": draft_markdown}
    if title:
        plan.title = title.strip()
    service._repo.save(plan)

    _schedule_progress(
        {
            "type": "plan_updated",
            "planId": str(ctx.plan_id),
            "summary": "itinerary draft applied",
        }
    )

    return dumps_json({"ok": True, "planId": str(ctx.plan_id), "bytes": len(draft_markdown)})


def build_get_current_plan_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="get_current_plan",
        description="Load the travel plan bound to this chat (requires planId).",
        func=_get_current_plan,
        args_schema=EmptyInput,
    )


def build_list_my_plans_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="list_my_plans",
        description="List the current user's travel plans (paginated summaries).",
        func=_list_my_plans,
        args_schema=ListPlansInput,
    )


def build_update_plan_fields_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="update_plan_fields",
        description="Update title/description/dates/destinations on the bound plan.",
        func=_update_plan_fields,
        args_schema=UpdatePlanFieldsInput,
    )


def build_apply_itinerary_draft_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="apply_itinerary_draft",
        description="Write a structured itinerary draft onto the bound plan.",
        func=_apply_itinerary_draft,
        args_schema=ApplyItineraryDraftInput,
    )
