"""CRUD smoke tests for travel plans (auth required)."""

from __future__ import annotations

from backend.app.models.travel_plan import TravelPlan
from backend.app.schemas.plan import CreatePlanRequest, PlanListResponse


def test_travel_plan_model_tablename():
    assert TravelPlan.__tablename__ == "travel_plans"


def test_create_plan_request_aliases():
    body = CreatePlanRequest.model_validate(
        {
            "title": "成都三日",
            "startDate": "2026-08-01",
            "endDate": "2026-08-03",
            "destinations": [{"name": "宽窄巷子", "lat": 30.67, "lon": 104.05, "stayDays": 1}],
        }
    )
    assert body.title == "成都三日"
    assert body.start_date is not None
    assert body.destinations[0].stay_days == 1


def test_plan_list_response_shape():
    payload = PlanListResponse.model_validate({"items": [], "total": 0, "page": 1, "pageSize": 20})
    assert payload.page_size == 20
