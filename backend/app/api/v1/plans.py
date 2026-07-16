from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from backend.app.api.deps import get_current_user, get_plan_service
from backend.app.models.user import User
from backend.app.schemas.plan import (
    CreatePlanRequest,
    PlanDetailResponse,
    PlanListResponse,
    UpdatePlanRequest,
)
from backend.app.services.plan_service import PlanService

router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("", response_model_by_alias=True)
def list_plans(
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanService, Depends(get_plan_service)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100, alias="pageSize")] = 20,
) -> PlanListResponse:
    return service.list_plans(user, page=page, page_size=page_size)


@router.post(
    "",
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
def create_plan(
    body: CreatePlanRequest,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanService, Depends(get_plan_service)],
) -> PlanDetailResponse:
    return service.create_plan(user, body)


@router.get("/{plan_id}", response_model_by_alias=True)
def get_plan(
    plan_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanService, Depends(get_plan_service)],
) -> PlanDetailResponse:
    return service.get_plan(user, plan_id)


@router.put("/{plan_id}", response_model_by_alias=True)
def update_plan(
    plan_id: UUID,
    body: UpdatePlanRequest,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanService, Depends(get_plan_service)],
) -> PlanDetailResponse:
    return service.update_plan(user, plan_id, body)


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(
    plan_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanService, Depends(get_plan_service)],
) -> Response:
    service.delete_plan(user, plan_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
