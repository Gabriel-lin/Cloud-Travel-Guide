"""Shared tool registry — agents declare tool_ids; Phase 2 binds them to LangGraph."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from langchain_core.tools import BaseTool


@dataclass(frozen=True, slots=True)
class ToolSpec:
    id: str
    name: str
    description: str
    factory: Callable[[], BaseTool]
    tags: tuple[str, ...] = ()


class ToolRegistry:
    def __init__(self, specs: Sequence[ToolSpec]) -> None:
        self._specs = {s.id: s for s in specs}

    def get(self, tool_id: str) -> ToolSpec:
        if tool_id not in self._specs:
            raise KeyError(f"Unknown tool: {tool_id}")
        return self._specs[tool_id]

    def resolve(self, tool_ids: Sequence[str]) -> list[BaseTool]:
        tools: list[BaseTool] = []
        seen: set[str] = set()
        for tool_id in tool_ids:
            if tool_id in seen:
                continue
            seen.add(tool_id)
            tools.append(self.get(tool_id).factory())
        return tools

    def list_public(self) -> list[dict[str, Any]]:
        return [
            {
                "id": s.id,
                "name": s.name,
                "description": s.description,
                "tags": list(s.tags),
            }
            for s in self._specs.values()
        ]


def _build_catalog() -> list[ToolSpec]:
    from backend.app.agents.tools.calculator import build_calculator_tool
    from backend.app.agents.tools.currency import build_convert_currency_tool
    from backend.app.agents.tools.datetime_tool import (
        build_convert_timezone_tool,
        build_current_datetime_tool,
    )
    from backend.app.agents.tools.document_export import build_convert_markdown_to_pdf_tool
    from backend.app.agents.tools.files import (
        build_copy_file_tool,
        build_file_delete_tool,
        build_file_search_tool,
        build_list_directory_tool,
        build_move_file_tool,
        build_read_file_tool,
        build_write_file_tool,
    )
    from backend.app.agents.tools.json_tool import (
        build_json_parse_tool,
        build_json_pretty_tool,
    )
    from backend.app.agents.tools.plan_entity import (
        build_apply_itinerary_draft_tool,
        build_get_current_plan_tool,
        build_list_my_plans_tool,
        build_update_plan_fields_tool,
    )
    from backend.app.agents.tools.sandbox import (
        build_cancel_sandbox_job_tool,
        build_get_sandbox_job_tool,
        build_run_sandbox_job_tool,
    )
    from backend.app.agents.tools.search.tool import build_web_search_tool
    from backend.app.agents.tools.slug_uuid import (
        build_generate_uuid_tool,
        build_slugify_tool,
    )
    from backend.app.agents.tools.text_diff import build_text_diff_tool
    from backend.app.agents.tools.travel.budget_estimate import build_estimate_budget_tool
    from backend.app.agents.tools.travel.distance import build_estimate_transit_gap_tool
    from backend.app.agents.tools.travel.geocode import build_geocode_place_tool
    from backend.app.agents.tools.travel.itinerary_validate import (
        build_draft_day_skeleton_tool,
        build_validate_itinerary_tool,
    )
    from backend.app.agents.tools.travel.pace_score import build_score_pace_tool
    from backend.app.agents.tools.travel.weather import build_weather_summary_tool
    from backend.app.agents.tools.units import build_convert_units_tool
    from backend.app.agents.tools.wikipedia_tool import build_wikipedia_tool

    return [
        # --- common / research ---
        ToolSpec(
            id="web_search",
            name="web_search",
            description="Search the public web via the configured SearchProvider.",
            factory=build_web_search_tool,
            tags=("common", "research"),
        ),
        ToolSpec(
            id="wikipedia",
            name="wikipedia",
            description="Encyclopedia lookup for places and cultural background (LangChain).",
            factory=build_wikipedia_tool,
            tags=("common", "research"),
        ),
        ToolSpec(
            id="current_datetime",
            name="current_datetime",
            description="Return the current UTC and local ISO timestamps.",
            factory=build_current_datetime_tool,
            tags=("common",),
        ),
        ToolSpec(
            id="convert_timezone",
            name="convert_timezone",
            description="Convert an ISO datetime into a target IANA timezone.",
            factory=build_convert_timezone_tool,
            tags=("common",),
        ),
        ToolSpec(
            id="calculator",
            name="calculator",
            description="Evaluate a safe arithmetic expression for budgets and counts.",
            factory=build_calculator_tool,
            tags=("common",),
        ),
        ToolSpec(
            id="convert_units",
            name="convert_units",
            description="Convert distance, temperature, and weight units.",
            factory=build_convert_units_tool,
            tags=("common",),
        ),
        ToolSpec(
            id="convert_currency",
            name="convert_currency",
            description="Convert currency amounts via a free public FX feed.",
            factory=build_convert_currency_tool,
            tags=("common",),
        ),
        ToolSpec(
            id="json_parse",
            name="json_parse",
            description="Parse and validate a JSON string.",
            factory=build_json_parse_tool,
            tags=("common",),
        ),
        ToolSpec(
            id="json_pretty",
            name="json_pretty",
            description="Pretty-print a JSON string.",
            factory=build_json_pretty_tool,
            tags=("common",),
        ),
        ToolSpec(
            id="text_diff",
            name="text_diff",
            description="Unified diff between two texts (itinerary revisions).",
            factory=build_text_diff_tool,
            tags=("common",),
        ),
        ToolSpec(
            id="generate_uuid",
            name="generate_uuid",
            description="Generate a random UUID v4.",
            factory=build_generate_uuid_tool,
            tags=("common",),
        ),
        ToolSpec(
            id="slugify",
            name="slugify",
            description="Turn a title into a filesystem-safe slug.",
            factory=build_slugify_tool,
            tags=("common", "files"),
        ),
        # --- common / files (LangChain FileManagementToolkit) ---
        ToolSpec(
            id="read_file",
            name="read_file",
            description="Read a file inside the agent workspace (LangChain FileManagementToolkit).",
            factory=build_read_file_tool,
            tags=("common", "files"),
        ),
        ToolSpec(
            id="write_file",
            name="write_file",
            description="Write a file inside the agent workspace (LangChain FileManagementToolkit).",
            factory=build_write_file_tool,
            tags=("common", "files"),
        ),
        ToolSpec(
            id="list_directory",
            name="list_directory",
            description="List a directory inside the agent workspace (LangChain FileManagementToolkit).",
            factory=build_list_directory_tool,
            tags=("common", "files"),
        ),
        ToolSpec(
            id="copy_file",
            name="copy_file",
            description="Copy a file inside the agent workspace (LangChain FileManagementToolkit).",
            factory=build_copy_file_tool,
            tags=("common", "files"),
        ),
        ToolSpec(
            id="move_file",
            name="move_file",
            description="Move/rename a file inside the agent workspace (LangChain FileManagementToolkit).",
            factory=build_move_file_tool,
            tags=("common", "files"),
        ),
        ToolSpec(
            id="file_search",
            name="file_search",
            description="Search files by pattern inside the agent workspace (LangChain FileManagementToolkit).",
            factory=build_file_search_tool,
            tags=("common", "files"),
        ),
        ToolSpec(
            id="file_delete",
            name="file_delete",
            description="Delete a file inside the agent workspace (LangChain FileManagementToolkit).",
            factory=build_file_delete_tool,
            tags=("common", "files"),
        ),
        ToolSpec(
            id="convert_markdown_to_pdf",
            name="convert_markdown_to_pdf",
            description=(
                "Convert a workspace markdown file to a styled PDF via the platform renderer."
            ),
            factory=build_convert_markdown_to_pdf_tool,
            tags=("common", "files", "export"),
        ),
        # --- plan entity ---
        ToolSpec(
            id="get_current_plan",
            name="get_current_plan",
            description="Load the travel plan bound to this chat (requires planId).",
            factory=build_get_current_plan_tool,
            tags=("plan",),
        ),
        ToolSpec(
            id="list_my_plans",
            name="list_my_plans",
            description="List the current user's travel plans.",
            factory=build_list_my_plans_tool,
            tags=("plan",),
        ),
        ToolSpec(
            id="update_plan_fields",
            name="update_plan_fields",
            description="Update title/description/dates/destinations on the bound plan.",
            factory=build_update_plan_fields_tool,
            tags=("plan",),
        ),
        ToolSpec(
            id="apply_itinerary_draft",
            name="apply_itinerary_draft",
            description="Write a structured itinerary draft onto the bound plan.",
            factory=build_apply_itinerary_draft_tool,
            tags=("plan",),
        ),
        # --- sandbox jobs ---
        ToolSpec(
            id="run_sandbox_job",
            name="run_sandbox_job",
            description="Run a python/bash script in the Docker sandbox (async job).",
            factory=build_run_sandbox_job_tool,
            tags=("sandbox",),
        ),
        ToolSpec(
            id="get_sandbox_job",
            name="get_sandbox_job",
            description="Get sandbox job status by id.",
            factory=build_get_sandbox_job_tool,
            tags=("sandbox",),
        ),
        ToolSpec(
            id="cancel_sandbox_job",
            name="cancel_sandbox_job",
            description="Cancel a sandbox job owned by the current user.",
            factory=build_cancel_sandbox_job_tool,
            tags=("sandbox",),
        ),
        # --- travel / role-specific ---
        ToolSpec(
            id="geocode_place",
            name="geocode_place",
            description="Resolve a place name to approximate lat/lon via OpenStreetMap Nominatim.",
            factory=build_geocode_place_tool,
            tags=("travel", "geo"),
        ),
        ToolSpec(
            id="weather_summary",
            name="weather_summary",
            description="Fetch a short weather summary for lat/lon via Open-Meteo.",
            factory=build_weather_summary_tool,
            tags=("travel", "weather"),
        ),
        ToolSpec(
            id="estimate_budget",
            name="estimate_budget",
            description="Rough trip budget estimate from days, party size, and tier.",
            factory=build_estimate_budget_tool,
            tags=("travel", "planner"),
        ),
        ToolSpec(
            id="draft_day_skeleton",
            name="draft_day_skeleton",
            description="Validate/normalize a day-by-day itinerary skeleton JSON.",
            factory=build_draft_day_skeleton_tool,
            tags=("travel", "planner"),
        ),
        ToolSpec(
            id="validate_itinerary",
            name="validate_itinerary",
            description="Heuristic validation of itinerary structure and obvious issues.",
            factory=build_validate_itinerary_tool,
            tags=("travel", "critic"),
        ),
        ToolSpec(
            id="score_pace",
            name="score_pace",
            description="Score itinerary pace density (stops per day / risk of overcrowding).",
            factory=build_score_pace_tool,
            tags=("travel", "critic"),
        ),
        ToolSpec(
            id="estimate_transit_gap",
            name="estimate_transit_gap",
            description="Haversine distance + coarse transit time between two lat/lon points.",
            factory=build_estimate_transit_gap_tool,
            tags=("travel", "critic", "geo"),
        ),
    ]


@lru_cache
def get_tool_registry() -> ToolRegistry:
    return ToolRegistry(_build_catalog())


# Shared by all builtin agents — prefer LangChain / thin utilities here
COMMON_TOOL_IDS: tuple[str, ...] = (
    "web_search",
    "wikipedia",
    "current_datetime",
    "convert_timezone",
    "calculator",
    "convert_units",
    "convert_currency",
    "json_parse",
    "json_pretty",
    "text_diff",
    "generate_uuid",
    "slugify",
    "read_file",
    "write_file",
    "list_directory",
    "copy_file",
    "move_file",
    "file_search",
    "file_delete",
    "convert_markdown_to_pdf",
    "get_current_plan",
    "list_my_plans",
    "update_plan_fields",
    "apply_itinerary_draft",
    "run_sandbox_job",
    "get_sandbox_job",
    "cancel_sandbox_job",
)

PLANNER_TOOL_IDS: tuple[str, ...] = (
    *COMMON_TOOL_IDS,
    "geocode_place",
    "weather_summary",
    "estimate_budget",
    "draft_day_skeleton",
)

GUIDE_TOOL_IDS: tuple[str, ...] = (
    *COMMON_TOOL_IDS,
    "geocode_place",
    "weather_summary",
)

CRITIC_TOOL_IDS: tuple[str, ...] = (
    *COMMON_TOOL_IDS,
    "geocode_place",
    "validate_itinerary",
    "score_pace",
    "estimate_transit_gap",
)
