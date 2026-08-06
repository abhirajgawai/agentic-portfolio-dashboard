"""Moomoo normalizer tests against a pinned-position fixture.

The fixture mirrors the Futu/Moomoo OpenAPI PositionInfo shape as returned by
the hosted MCP (samples/moomoo/account_positions.json is the live capture -
this fixture stays in sync with it).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from portfolio.config import SAMPLES_DIR
from portfolio.normalize.moomoo import normalize_holdings, ticker_from_code
from portfolio.normalize.schema import Holding


def _fixture() -> dict:
    path = Path(SAMPLES_DIR) / "moomoo" / "account_positions.json"
    if path.exists():
        # live capture exists - use it (the pinned contract)
        payload = json.loads(path.read_text(encoding="utf-8"))
        content = payload.get("content", payload)
        text = None
        if isinstance(content, list):
            text = "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
        elif isinstance(content, dict):
            text = content.get("text")
        if text:
            import json as _json

            try:
                return _json.loads(text)
            except _json.JSONDecodeError:
                pass
    # fall back to the hand-built fixture (identical shape)
    return {
        "data": {
            "position_list": [
                {
                    "code": "US.AAPL",
                    "stock_name": "Apple Inc.",
                    "qty": 10,
                    "cost_price": 150.0,
                    "nominal_price": 155.0,
                    "cost_val": 1500.0,
                    "market_val": 1550.0,
                    "pl_ratio": 0.033,
                },
                {
                    "code": "US.NVDA",
                    "stock_name": "NVIDIA Corporation",
                    "qty": 5,
                    "cost_price": 100.0,
                    "nominal_price": 120.0,
                    "cost_val": 500.0,
                    "market_val": 600.0,
                    "pl_ratio": 0.2,
                },
            ]
        }
    }


def test_ticker_from_code():
    assert ticker_from_code("US.AAPL") == "AAPL"
    assert ticker_from_code("HK.00700") == "00700"
    assert ticker_from_code("AAPL") == "AAPL"


def test_normalize_moomoo_basic():
    holdings = normalize_holdings(_fixture())
    assert len(holdings) == 2

    aapl = next(h for h in holdings if h.ticker == "AAPL")
    assert aapl.platform == "moomoo"
    assert aapl.geography == "US"
    assert aapl.currency == "USD"
    assert aapl.name == "Apple Inc."
    assert aapl.quantity == 10
    assert aapl.avg_price == 150.0
    assert aapl.current_price == 155.0
    assert aapl.cost_basis == 1500.0
    assert aapl.current_value == 1550.0

    nvda = next(h for h in holdings if h.ticker == "NVDA")
    assert nvda.current_value == 600.0
    assert nvda.cost_basis == 500.0


def test_market_val_fallback_to_price_qty():
    payload = {
        "data": {
            "position_list": [
                {"code": "US.TSLA", "qty": 2, "nominal_price": 250.0}  # no cost/market vals
            ]
        }
    }
    holdings = normalize_holdings(payload)
    assert len(holdings) == 1
    tsla = holdings[0]
    assert tsla.current_value == 500.0
    assert tsla.avg_price is None
    assert tsla.cost_basis is None


def test_flat_list_shape_supported():
    payload = [{"code": "US.AAPL", "qty": 1, "nominal_price": 100.0}]
    holdings = normalize_holdings(payload)
    assert len(holdings) == 1
    assert isinstance(holdings[0], Holding)


def test_empty_and_junk_are_noops():
    assert normalize_holdings([]) == []
    assert normalize_holdings({"foo": "bar"}) == []
    assert normalize_holdings(None) == []


def test_single_position_dict_shape():
    """The OpenD wrapper can return one position as a bare dict (real VOO sample)."""
    payload = {
        "code": "US.VOO",
        "stock_name": "Vanguard S&P 500 ETF",
        "qty": 9.5109,
        "cost_price": 632.042,
        "nominal_price": 709.22,
        "market_val": 6745.32,
        "currency": "USD",
    }
    holdings = normalize_holdings(payload)
    assert len(holdings) == 1
    voo = holdings[0]
    assert voo.ticker == "VOO"
    assert voo.quantity == pytest.approx(9.5109)
    assert voo.current_price == pytest.approx(709.22)
    assert voo.current_value == pytest.approx(6745.32)


def test_pinned_live_sample_normalizes():
    """The live captured output (samples/moomoo/account_positions_authed.json,
    gitignored private data) must normalize to the account's actual holdings.
    The wrapper returns {"positions": [...]}. Skipped where the sample is not
    present (CI / other machines) - the hand-built fixture covers the logic."""
    path = Path(SAMPLES_DIR) / "moomoo" / "account_positions_authed.json"
    if not path.exists():
        pytest.skip("live sample not captured on this machine")
    sample = json.loads(path.read_text(encoding="utf-8"))
    content = sample.get("content", sample)
    holdings = normalize_holdings(content)
    assert len(holdings) == 6
    tickers = {h.ticker for h in holdings}
    assert {"VOO", "SMH", "MU", "IBM", "IAU", "GOOGL"} == tickers
    assert all(h.platform == "moomoo" and h.currency == "USD" for h in holdings)


def test_sector_enrichment():
    holdings = normalize_holdings(_fixture(), sectors={"AAPL": ("Tech", "equity")})
    aapl = next(h for h in holdings if h.ticker == "AAPL")
    assert aapl.sector == "Tech"
    assert aapl.asset_class == "equity"
