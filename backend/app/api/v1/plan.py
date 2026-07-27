from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.app.api.deps import get_current_user, get_db, get_plan_chat_service
from backend.app.core.exceptions import AppError
from backend.app.models.user import User
from backend.app.schemas.plan import AgentsResponse, PlanChatRequest, WorkspaceFileResponse
from backend.app.services.plan_chat_service import PlanChatService
from backend.app.services.workspace_file_service import read_workspace_file_base64

router = APIRouter(prefix="/plan", tags=["plan"])


@router.get("/agents", response_model_by_alias=True)
def list_agents(
    service: Annotated[PlanChatService, Depends(get_plan_chat_service)],
) -> AgentsResponse:
    return AgentsResponse.model_validate(service.list_catalog())


@router.post("/chat")
async def plan_chat(
    body: PlanChatRequest,
    service: Annotated[PlanChatService, Depends(get_plan_chat_service)],
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StreamingResponse:
    """SSE streaming chat with LangGraph tool loop (auth required)."""
    try:
        service.resolve_agent(body.agent_id)
        if body.plan_id is not None:
            from backend.app.services.plan_service import PlanService

            PlanService(db).get_plan(user, body.plan_id)
    except AppError:
        raise

    async def event_generator():
        async for chunk in service.stream_chat(body, user=user, db=db):
            yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/workspace/file", response_model_by_alias=True)
def get_workspace_file(
    path: str,
    _user: Annotated[User, Depends(get_current_user)],
) -> WorkspaceFileResponse:
    """Download a file from the agent workspace (base64) for in-chat preview."""
    payload = read_workspace_file_base64(path)
    return WorkspaceFileResponse.model_validate(payload)
