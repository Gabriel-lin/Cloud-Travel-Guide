from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.plan_chat_thread import PlanChatThread


class PlanChatThreadRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_by_user(
        self,
        user_id: uuid.UUID,
        *,
        status: str | None = None,
    ) -> list[PlanChatThread]:
        stmt = select(PlanChatThread).where(PlanChatThread.user_id == user_id)
        if status is not None:
            stmt = stmt.where(PlanChatThread.status == status)
        return list(self._db.scalars(stmt.order_by(PlanChatThread.updated_at.desc())))

    def get_for_user(self, thread_id: str, user_id: uuid.UUID) -> PlanChatThread | None:
        return self._db.scalar(
            select(PlanChatThread).where(
                PlanChatThread.id == thread_id,
                PlanChatThread.user_id == user_id,
            )
        )

    def add(self, thread: PlanChatThread) -> PlanChatThread:
        self._db.add(thread)
        self._db.commit()
        self._db.refresh(thread)
        return thread

    def save(self, thread: PlanChatThread) -> PlanChatThread:
        self._db.commit()
        self._db.refresh(thread)
        return thread

    def delete(self, thread: PlanChatThread) -> None:
        self._db.delete(thread)
        self._db.commit()
