from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from backend.app.api.deps import get_plan_chat_service
from backend.app.core.exceptions import AppError
from backend.app.schemas.plan import AgentsResponse, PlanChatRequest
from backend.app.services.plan_chat_service import PlanChatService

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
) -> StreamingResponse:
    """SSE streaming chat — OpenAI-compatible models via LiteLLM router."""
    # Validate before headers are sent so AppError maps to JSON HTTP errors.
    try:
        service.resolve_agent(body.agent_id)
    except AppError:
        raise

    async def event_generator():
        async for chunk in service.stream_chat(body):
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
