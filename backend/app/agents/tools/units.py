"""Unit conversion for distance, temperature, and weight."""

from __future__ import annotations

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json

# (from, to) -> multiplier applied to value
_DISTANCE = {
    ("km", "mi"): 0.621371,
    ("mi", "km"): 1.60934,
    ("m", "km"): 0.001,
    ("km", "m"): 1000.0,
    ("m", "ft"): 3.28084,
    ("ft", "m"): 0.3048,
}
_WEIGHT = {
    ("kg", "lb"): 2.20462,
    ("lb", "kg"): 0.453592,
    ("g", "kg"): 0.001,
    ("kg", "g"): 1000.0,
}


class ConvertUnitsInput(BaseModel):
    value: float
    from_unit: str = Field(description="e.g. km, mi, m, ft, C, F, kg, lb")
    to_unit: str = Field(description="Target unit")


def _normalize_unit(unit: str) -> str:
    u = unit.strip().lower().replace("°", "")
    aliases = {
        "celsius": "c",
        "fahrenheit": "f",
        "kilometer": "km",
        "kilometers": "km",
        "mile": "mi",
        "miles": "mi",
        "meter": "m",
        "meters": "m",
        "foot": "ft",
        "feet": "ft",
        "kilogram": "kg",
        "kilograms": "kg",
        "pound": "lb",
        "pounds": "lb",
        "gram": "g",
        "grams": "g",
    }
    return aliases.get(u, u)


def _convert_units(value: float, from_unit: str, to_unit: str) -> str:
    src = _normalize_unit(from_unit)
    dst = _normalize_unit(to_unit)
    if src == dst:
        return dumps_json({"ok": True, "value": value, "unit": dst})

    # Temperature
    if src in {"c", "f"} and dst in {"c", "f"}:
        result = value * 9 / 5 + 32 if src == "c" and dst == "f" else (value - 32) * 5 / 9
        return dumps_json(
            {"ok": True, "value": round(result, 4), "from": f"{value}{src}", "to_unit": dst}
        )

    table = {**_DISTANCE, **_WEIGHT}
    factor = table.get((src, dst))
    if factor is None:
        return dumps_json(
            {
                "ok": False,
                "error": f"Unsupported conversion {from_unit!r} -> {to_unit!r}",
                "supported": sorted({f"{a}->{b}" for a, b in table} | {"c->f", "f->c"}),
            }
        )
    return dumps_json(
        {
            "ok": True,
            "value": round(value * factor, 6),
            "from": f"{value} {src}",
            "to_unit": dst,
        }
    )


def build_convert_units_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="convert_units",
        description=("Convert units: distance (km/mi/m/ft), temperature (C/F), weight (kg/lb/g)."),
        func=_convert_units,
        args_schema=ConvertUnitsInput,
    )
