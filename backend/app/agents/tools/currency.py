"""Currency conversion via a free public FX feed (no API key)."""

from __future__ import annotations

import logging

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json

logger = logging.getLogger(__name__)

# Community FX mirror — includes CNY; no API key required.
CURRENCY_API_TMPL = (
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{code}.json"
)
CURRENCY_API_FALLBACK_TMPL = "https://latest.currency-api.pages.dev/v1/currencies/{code}.json"


class ConvertCurrencyInput(BaseModel):
    amount: float = Field(gt=0, description="Amount in the source currency")
    from_currency: str = Field(description="ISO 4217 code, e.g. USD, CNY, EUR, JPY")
    to_currency: str = Field(description="ISO 4217 code, e.g. CNY, USD, EUR")


def _fetch_rates(src: str) -> dict:
    urls = [
        CURRENCY_API_TMPL.format(code=src.lower()),
        CURRENCY_API_FALLBACK_TMPL.format(code=src.lower()),
    ]
    last_error: Exception | None = None
    with httpx.Client(timeout=15.0) as client:
        for url in urls:
            try:
                response = client.get(url)
                response.raise_for_status()
                data = response.json()
                rates = data.get(src.lower())
                if isinstance(rates, dict):
                    return {"date": data.get("date"), "rates": rates}
            except Exception as exc:  # try next mirror
                last_error = exc
                logger.warning("currency feed failed url=%s err=%s", url, exc)
    raise RuntimeError(str(last_error) if last_error else "currency feed unavailable")


def _convert_currency(amount: float, from_currency: str, to_currency: str) -> str:
    src = from_currency.strip().upper()
    dst = to_currency.strip().upper()
    if src == dst:
        return dumps_json(
            {"ok": True, "amount": amount, "from": src, "to": dst, "result": amount, "rate": 1.0}
        )
    try:
        payload = _fetch_rates(src)
    except Exception as exc:
        logger.exception("currency convert failed %s->%s", src, dst)
        return dumps_json({"ok": False, "error": str(exc)})

    rates = payload["rates"]
    rate = rates.get(dst.lower())
    if rate is None:
        return dumps_json(
            {
                "ok": False,
                "error": f"No rate for {dst}",
                "hint": "Check ISO currency codes (USD/CNY/EUR/JPY/...).",
            }
        )
    result = float(amount) * float(rate)
    return dumps_json(
        {
            "ok": True,
            "amount": amount,
            "from": src,
            "to": dst,
            "rate": float(rate),
            "result": round(result, 4),
            "date": payload.get("date"),
            "source": "currency-api (jsdelivr)",
            "note": "Indicative mid-market rate, not a bank quote.",
        }
    )


def build_convert_currency_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="convert_currency",
        description=(
            "Convert currency amounts using a free public FX feed (no API key). "
            "Supports major codes including USD, CNY, EUR, JPY, GBP."
        ),
        func=_convert_currency,
        args_schema=ConvertCurrencyInput,
    )
