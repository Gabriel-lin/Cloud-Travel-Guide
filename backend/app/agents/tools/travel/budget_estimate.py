"""Rough trip budget estimator."""

from __future__ import annotations

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json

# CNY per person per day (lodging + food + local transit), coarse tiers
DAILY_CNY = {
    "budget": 250,
    "mid": 550,
    "comfort": 950,
    "luxury": 1800,
}


class BudgetInput(BaseModel):
    days: int = Field(ge=1, le=60, description="Trip length in days")
    party_size: int = Field(default=1, ge=1, le=20, description="Number of travelers")
    tier: str = Field(
        default="mid",
        description="budget | mid | comfort | luxury",
    )
    intercity_transport_cny: float = Field(
        default=0,
        ge=0,
        description="Optional fixed intercity transport cost (tickets) in CNY",
    )
    currency: str = Field(default="CNY")


def _estimate_budget(
    days: int,
    party_size: int = 1,
    tier: str = "mid",
    intercity_transport_cny: float = 0,
    currency: str = "CNY",
) -> str:
    key = tier.lower().strip()
    daily = DAILY_CNY.get(key)
    if daily is None:
        return dumps_json(
            {
                "ok": False,
                "error": f"Unknown tier {tier!r}; use budget|mid|comfort|luxury",
            }
        )
    daily_total = daily * days * party_size
    grand = daily_total + intercity_transport_cny
    return dumps_json(
        {
            "ok": True,
            "currency": currency,
            "tier": key,
            "days": days,
            "party_size": party_size,
            "daily_per_person_cny": daily,
            "on_ground_total": daily_total,
            "intercity_transport": intercity_transport_cny,
            "estimated_total": grand,
            "range": {
                "low": round(grand * 0.85),
                "high": round(grand * 1.25),
            },
            "note": "Heuristic CNY bands — not a quote; adjust for destination cost of living.",
        }
    )


def build_estimate_budget_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="estimate_budget",
        description="Estimate a rough trip budget from days, party size, and spend tier.",
        func=_estimate_budget,
        args_schema=BudgetInput,
    )
