from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.models.travel_plan import TravelPlan


class PlanRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_by_user(
        self,
        user_id: uuid.UUID,
        *,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[TravelPlan], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 100)
        base = select(TravelPlan).where(TravelPlan.user_id == user_id)
        total = self._db.scalar(
            select(func.count()).select_from(TravelPlan).where(TravelPlan.user_id == user_id)
        )
        items = list(
            self._db.scalars(
                base.order_by(TravelPlan.updated_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        return items, int(total or 0)

    def get_by_id_for_user(self, plan_id: uuid.UUID, user_id: uuid.UUID) -> TravelPlan | None:
        return self._db.scalar(
            select(TravelPlan).where(
                TravelPlan.id == plan_id,
                TravelPlan.user_id == user_id,
            )
        )

    def add(self, plan: TravelPlan) -> TravelPlan:
        self._db.add(plan)
        self._db.commit()
        self._db.refresh(plan)
        return plan

    def save(self, plan: TravelPlan) -> TravelPlan:
        self._db.commit()
        self._db.refresh(plan)
        return plan

    def delete(self, plan: TravelPlan) -> None:
        self._db.delete(plan)
        self._db.commit()
