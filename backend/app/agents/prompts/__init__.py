"""Agent prompt modules."""

from backend.app.agents.prompts.base import BASE_GUARDRAILS
from backend.app.agents.prompts.itinerary_critic import ROLE_CORE as CRITIC_ROLE
from backend.app.agents.prompts.local_guide import ROLE_CORE as GUIDE_ROLE
from backend.app.agents.prompts.travel_planner import ROLE_CORE as PLANNER_ROLE

ROLE_BY_AGENT_ID: dict[str, str] = {
    "travel-planner": PLANNER_ROLE,
    "local-guide": GUIDE_ROLE,
    "itinerary-critic": CRITIC_ROLE,
}

__all__ = [
    "BASE_GUARDRAILS",
    "CRITIC_ROLE",
    "GUIDE_ROLE",
    "PLANNER_ROLE",
    "ROLE_BY_AGENT_ID",
]
