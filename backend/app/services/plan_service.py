"""Travel plan CRUD service."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from backend.app.core.exceptions import NotFoundError
from backend.app.models.travel_plan import TravelPlan
from backend.app.models.user import User
from backend.app.repositories.plan_repository import PlanRepository
from backend.app.schemas.plan import (
    CreatePlanRequest,
    PlanDestination,
    PlanDetailResponse,
    PlanItemResponse,
    PlanListResponse,
    UpdatePlanRequest,
)


def _destinations_payload(destinations: list[PlanDestination]) -> list[dict[str, Any]]:
    return [
        {
            "name": d.name,
            "lat": d.lat,
            "lon": d.lon,
            "stayDays": d.stay_days,
        }
        for d in destinations
    ]


def _to_item(plan: TravelPlan) -> PlanItemResponse:
    return PlanItemResponse(
        id=plan.id,
        title=plan.title,
        start_date=plan.start_date,
        end_date=plan.end_date,
        destination_count=plan.destination_count,
        updated_at=plan.updated_at,
    )


def _to_detail(plan: TravelPlan) -> PlanDetailResponse:
    raw = plan.destinations or []
    destinations = [PlanDestination.model_validate(item) for item in raw if isinstance(item, dict)]
    return PlanDetailResponse(
        id=plan.id,
        title=plan.title,
        description=plan.description,
        start_date=plan.start_date,
        end_date=plan.end_date,
        destination_count=plan.destination_count,
        updated_at=plan.updated_at,
        destinations=destinations,
    )


class PlanService:
    def __init__(self, db: Session) -> None:
        self._repo = PlanRepository(db)

    def list_plans(self, user: User, *, page: int = 1, page_size: int = 20) -> PlanListResponse:
        items, total = self._repo.list_by_user(user.id, page=page, page_size=page_size)
        return PlanListResponse(
            items=[_to_item(p) for p in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    def get_plan(self, user: User, plan_id: uuid.UUID) -> PlanDetailResponse:
        plan = self._repo.get_by_id_for_user(plan_id, user.id)
        if plan is None:
            raise NotFoundError("Plan not found")
        return _to_detail(plan)

    def create_plan(self, user: User, body: CreatePlanRequest) -> PlanDetailResponse:
        destinations = _destinations_payload(body.destinations)
        plan = TravelPlan(
            user_id=user.id,
            title=body.title.strip(),
            description=body.description,
            start_date=body.start_date,
            end_date=body.end_date,
            destinations=destinations,
            destination_count=len(destinations),
        )
        return _to_detail(self._repo.add(plan))

    def update_plan(
        self, user: User, plan_id: uuid.UUID, body: UpdatePlanRequest
    ) -> PlanDetailResponse:
        plan = self._repo.get_by_id_for_user(plan_id, user.id)
        if plan is None:
            raise NotFoundError("Plan not found")

        data = body.model_dump(exclude_unset=True, by_alias=False)
        if "title" in data and data["title"] is not None:
            plan.title = str(data["title"]).strip()
        if "description" in data:
            plan.description = data["description"]
        if "start_date" in data:
            plan.start_date = data["start_date"]
        if "end_date" in data:
            plan.end_date = data["end_date"]
        if "destinations" in data and body.destinations is not None:
            destinations = _destinations_payload(body.destinations)
            plan.destinations = destinations
            plan.destination_count = len(destinations)

        return _to_detail(self._repo.save(plan))

    def delete_plan(self, user: User, plan_id: uuid.UUID) -> None:
        plan = self._repo.get_by_id_for_user(plan_id, user.id)
        if plan is None:
            raise NotFoundError("Plan not found")
        self._repo.delete(plan)
