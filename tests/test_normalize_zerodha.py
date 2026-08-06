"""Zerodha normalizer: raw holdings JSON -> common schema (deterministic)."""

from __future__ import annotations

import json
from pathlib import Path

from portfolio.normalize.zerodha import normalize_holdings

FIXTURE = Path(__file__).parent / "fixtures" / "zerodha_holdings.json"


def _raw() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_normalize_infy() -> None:
    holdings = normalize_holdings(_raw(), sectors={"INFY": ("IT Services", "Equity")})
    infy = next(h for h in holdings if h.ticker == "INFY")
    assert infy.platform == "zerodha"
    assert infy.geography == "IN"
    assert infy.currency == "INR"
    assert infy.quantity == 10.0
    assert infy.avg_price == 1500.0
    assert infy.current_price == 1610.0
    assert infy.cost_basis == 15000.0
    assert infy.current_value == 16100.0
    assert infy.sector == "IT Services"
    assert infy.asset_class == "Equity"
    assert infy.name is None


def test_missing_average_price_yields_null_cost_basis() -> None:
    holdings = normalize_holdings(_raw())
    tata = next(h for h in holdings if h.ticker == "TATAMOTORS")
    assert tata.avg_price is None
    assert tata.cost_basis is None
    assert tata.current_value == 20.0 * 950.0


def test_name_preserved_when_present() -> None:
    sbin = next(h for h in normalize_holdings(_raw()) if h.ticker == "SBIN")
    assert sbin.name == "State Bank of India"


def test_skips_row_without_tradingsymbol() -> None:
    payload = [{"x": 1}, {"tradingsymbol": "T", "quantity": 1, "last_price": 2}]
    holdings = normalize_holdings(payload)
    assert [h.ticker for h in holdings] == ["T"]


def test_sectors_from_curated_map() -> None:
    holdings = normalize_holdings(_raw(), sectors={"INFY": ("IT", "Equity")})
    infy = next(h for h in holdings if h.ticker == "INFY")
    assert (infy.sector, infy.asset_class) == ("IT", "Equity")