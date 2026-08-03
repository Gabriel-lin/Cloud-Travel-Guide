from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from backend.app.api.deps import get_current_user, get_plan_chat_thread_service
from backend.app.models.user import User
from backend.app.schemas.plan_thread import (
    InitializePlanThreadRequest,
    PlanThreadHistoryResponse,
    PlanThreadInitializeResponse,
    PlanThreadListResponse,
    PlanThreadMetadataResponse,
    PutPlanThreadHistoryRequest,
    UpdatePlanThreadRequest,
)
from backend.app.services.plan_chat_thread_service import PlanChatThreadService

router = APIRouter(prefix="/plan/threads", tags=["plan-threads"])


@router.get("", response_model_by_alias=True)
def list_plan_threads(
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanChatThreadService, Depends(get_plan_chat_thread_service)],
) -> PlanThreadListResponse:
    return service.list_threads(user)


@router.post(
    "",
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
def initialize_plan_thread(
    body: InitializePlanThreadRequest,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanChatThreadService, Depends(get_plan_chat_thread_service)],
) -> PlanThreadInitializeResponse:
    return service.initialize(user, body)


@router.get("/{thread_id}", response_model_by_alias=True)
def get_plan_thread(
    thread_id: str,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanChatThreadService, Depends(get_plan_chat_thread_service)],
) -> PlanThreadMetadataResponse:
    return service.get_thread(user, thread_id)


@router.patch("/{thread_id}", response_model_by_alias=True)
def update_plan_thread(
    thread_id: str,
    body: UpdatePlanThreadRequest,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanChatThreadService, Depends(get_plan_chat_thread_service)],
) -> PlanThreadMetadataResponse:
    return service.update_thread(user, thread_id, body)


@router.delete("/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan_thread(
    thread_id: str,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanChatThreadService, Depends(get_plan_chat_thread_service)],
) -> Response:
    service.delete_thread(user, thread_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{thread_id}/history", response_model_by_alias=True)
def get_plan_thread_history(
    thread_id: str,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanChatThreadService, Depends(get_plan_chat_thread_service)],
) -> PlanThreadHistoryResponse:
    return service.get_history(user, thread_id)


@router.put("/{thread_id}/history", response_model_by_alias=True)
def put_plan_thread_history(
    thread_id: str,
    body: PutPlanThreadHistoryRequest,
    user: Annotated[User, Depends(get_current_user)],
    service: Annotated[PlanChatThreadService, Depends(get_plan_chat_thread_service)],
) -> PlanThreadHistoryResponse:
    return service.put_history(user, thread_id, body)
