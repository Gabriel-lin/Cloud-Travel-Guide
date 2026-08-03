"""Plan chat thread persistence (assistant-ui remote thread list + history)."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from backend.app.core.exceptions import BadRequestError, NotFoundError
from backend.app.models.plan_chat_thread import PlanChatThread
from backend.app.models.user import User
from backend.app.repositories.plan_chat_thread_repository import PlanChatThreadRepository
from backend.app.schemas.plan_thread import (
    InitializePlanThreadRequest,
    PlanThreadHistoryResponse,
    PlanThreadInitializeResponse,
    PlanThreadListResponse,
    PlanThreadMetadataResponse,
    PutPlanThreadHistoryRequest,
    UpdatePlanThreadRequest,
)

_THREAD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_MAX_HISTORY_BYTES = 1_500_000
_VALID_STATUS = frozenset({"regular", "archived"})


def _validate_thread_id(thread_id: str) -> str:
    if not _THREAD_ID_RE.fullmatch(thread_id):
        raise BadRequestError("Invalid thread id")
    return thread_id


def _empty_history() -> dict[str, Any]:
    return {"messages": []}


def _to_metadata(thread: PlanChatThread) -> PlanThreadMetadataResponse:
    status = thread.status if thread.status in _VALID_STATUS else "regular"
    return PlanThreadMetadataResponse(
        remote_id=thread.id,
        external_id=thread.external_id,
        status=status,  # type: ignore[arg-type]
        title=thread.title,
        last_message_at=thread.last_message_at,
        custom=thread.custom,
        updated_at=thread.updated_at,
    )


class PlanChatThreadService:
    def __init__(self, db: Session) -> None:
        self._repo = PlanChatThreadRepository(db)

    def list_threads(self, user: User) -> PlanThreadListResponse:
        threads = self._repo.list_by_user(user.id)
        return PlanThreadListResponse(threads=[_to_metadata(t) for t in threads])

    def initialize(
        self,
        user: User,
        body: InitializePlanThreadRequest,
    ) -> PlanThreadInitializeResponse:
        thread_id = _validate_thread_id(body.thread_id)
        existing = self._repo.get_for_user(thread_id, user.id)
        if existing is None:
            thread = PlanChatThread(
                id=thread_id,
                user_id=user.id,
                status="regular",
                history_repo=_empty_history(),
            )
            self._repo.add(thread)
        return PlanThreadInitializeResponse(
            remote_id=thread_id,
            external_id=None,
        )

    def get_thread(self, user: User, thread_id: str) -> PlanThreadMetadataResponse:
        thread = self._require_thread(user, thread_id)
        return _to_metadata(thread)

    def update_thread(
        self,
        user: User,
        thread_id: str,
        body: UpdatePlanThreadRequest,
    ) -> PlanThreadMetadataResponse:
        thread = self._require_thread(user, thread_id)
        if body.title is not None:
            thread.title = body.title
        if body.status is not None:
            if body.status not in _VALID_STATUS:
                raise BadRequestError("Invalid thread status")
            thread.status = body.status
        if body.custom is not None:
            thread.custom = body.custom
        return _to_metadata(self._repo.save(thread))

    def delete_thread(self, user: User, thread_id: str) -> None:
        thread = self._require_thread(user, thread_id)
        self._repo.delete(thread)

    def get_history(self, user: User, thread_id: str) -> PlanThreadHistoryResponse:
        thread = self._require_thread(user, thread_id)
        repo = thread.history_repo or _empty_history()
        messages = repo.get("messages")
        if not isinstance(messages, list):
            messages = []
        head_id = repo.get("headId")
        if head_id is not None and not isinstance(head_id, str):
            head_id = None
        return PlanThreadHistoryResponse(messages=messages, head_id=head_id)

    def put_history(
        self,
        user: User,
        thread_id: str,
        body: PutPlanThreadHistoryRequest,
    ) -> PlanThreadHistoryResponse:
        thread = self._require_thread(user, thread_id)
        payload = {
            "messages": body.messages,
            **({"headId": body.head_id} if body.head_id else {}),
        }
        encoded = json.dumps(payload, ensure_ascii=False)
        size = len(encoded.encode("utf-8"))
        if size > _MAX_HISTORY_BYTES:
            raise BadRequestError(
                f"Thread history exceeds size limit "
                f"({size} bytes > {_MAX_HISTORY_BYTES} bytes). "
                "Store file artifacts as workspace path refs, not inline base64."
            )
        thread.history_repo = payload
        thread.last_message_at = datetime.now(UTC)
        self._repo.save(thread)
        return PlanThreadHistoryResponse(
            messages=body.messages,
            head_id=body.head_id,
        )

    def _require_thread(self, user: User, thread_id: str) -> PlanChatThread:
        _validate_thread_id(thread_id)
        thread = self._repo.get_for_user(thread_id, user.id)
        if thread is None:
            raise NotFoundError("Thread not found")
        return thread
