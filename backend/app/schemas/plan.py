from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PlanChatMessage(BaseModel):
    role: str = Field(description="user | assistant | system")
    content: str


class PlanChatRequest(BaseModel):
    messages: list[PlanChatMessage]
    agent_id: str = Field(default="travel-planner", alias="agentId")
    model: str | None = Field(
        default=None,
        description="Optional model alias override (gpt-5.5 / opus-4.8 / deepseek-v3)",
    )
    thread_id: str | None = Field(default=None, alias="threadId")

    model_config = {"populate_by_name": True}


class AgentPublic(BaseModel):
    id: str
    kind: str
    name: str
    description: str
    default_model: str = Field(alias="defaultModel")
    enabled: bool
    status: str

    model_config = {"populate_by_name": True}


class ModelPublic(BaseModel):
    id: str
    label: str
    provider: str
    enabled: bool
    description: str
    configured: bool


class AgentsResponse(BaseModel):
    agents: list[AgentPublic]
    models: list[ModelPublic]
    default_agent_id: str = Field(alias="defaultAgentId")

    model_config = {"populate_by_name": True}


class PlanDestination(BaseModel):
    name: str
    lat: float
    lon: float
    stay_days: int | None = Field(default=None, alias="stayDays")

    model_config = {"populate_by_name": True}


class PlanItemResponse(BaseModel):
    id: UUID
    title: str
    start_date: date | None = Field(default=None, alias="startDate")
    end_date: date | None = Field(default=None, alias="endDate")
    destination_count: int = Field(alias="destinationCount")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True, "from_attributes": True}


class PlanDetailResponse(PlanItemResponse):
    description: str | None = None
    destinations: list[PlanDestination] = Field(default_factory=list)


class CreatePlanRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    start_date: date | None = Field(default=None, alias="startDate")
    end_date: date | None = Field(default=None, alias="endDate")
    destinations: list[PlanDestination] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class UpdatePlanRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    start_date: date | None = Field(default=None, alias="startDate")
    end_date: date | None = Field(default=None, alias="endDate")
    destinations: list[PlanDestination] | None = None

    model_config = {"populate_by_name": True}


class PlanListResponse(BaseModel):
    items: list[PlanItemResponse]
    total: int
    page: int
    page_size: int = Field(alias="pageSize")

    model_config = {"populate_by_name": True}
