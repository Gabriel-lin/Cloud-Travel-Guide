from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

ThreadStatus = Literal["regular", "archived"]


class InitializePlanThreadRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=128, alias="threadId")

    model_config = {"populate_by_name": True}


class PlanThreadInitializeResponse(BaseModel):
    remote_id: str = Field(alias="remoteId")
    external_id: str | None = Field(default=None, alias="externalId")

    model_config = {"populate_by_name": True}


class PlanThreadMetadataResponse(BaseModel):
    remote_id: str = Field(alias="remoteId")
    external_id: str | None = Field(default=None, alias="externalId")
    status: ThreadStatus
    title: str | None = None
    last_message_at: datetime | None = Field(default=None, alias="lastMessageAt")
    custom: dict[str, Any] | None = None
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True, "from_attributes": True}


class PlanThreadListResponse(BaseModel):
    threads: list[PlanThreadMetadataResponse]

    model_config = {"populate_by_name": True}


class UpdatePlanThreadRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    status: ThreadStatus | None = None
    custom: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class PlanThreadHistoryResponse(BaseModel):
    messages: list[Any] = Field(default_factory=list)
    head_id: str | None = Field(default=None, alias="headId")

    model_config = {"populate_by_name": True}


class PutPlanThreadHistoryRequest(BaseModel):
    messages: list[Any] = Field(default_factory=list)
    head_id: str | None = Field(default=None, alias="headId")

    model_config = {"populate_by_name": True}
