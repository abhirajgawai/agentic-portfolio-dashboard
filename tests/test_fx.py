"""FX module tests: reciprocal math, one-fetch-per-run, loud failure.

The pinned sample samples/fx/er_api_inr.json is a real open.er-api.com response
(1 INR in each currency), captured 2026-08-06. Tests inject it via `fetch=` so
no network is needed and the numbers are deterministic.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from portfolio.config import SAMPLES_DIR
from portfolio.fx import FXError, get_fx_rate, get_fx_rates, reset_fx_cache


@pytest.fixture(autouse=True)
def _clean_cache():
    reset_fx_cache()
    yield
    reset_fx_cache()


@pytest.fixture()
def sample_table() -> dict[str, float]:
    path = Path(SAMPLES_DIR) / "fx" / "er_api_inr.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["base_code"] == "INR"
    return {str(k): float(v) for k, v in payload["rates"].items()}


def _fetch_from_sample(sample: dict[str, float]):
    def fetch(base: str, source: str) -> dict[str, float]:
        assert base == "INR"  # our runs are INR-base
        assert source == "open.er-api.com"
        return sample

    return fetch


def test_identity_never_fetches():
    """INR/INR is 1.0 by definition - no network, no cache entry."""
    assert get_fx_rate("INR", "INR") == 1.0
    assert get_fx_rate("INR", "INR") == 1.0  # idempotent


def test_reciprocal_math_from_pinned_sample(sample_table):
    """rates[USD] is '1 INR in USD'; our contract is the inverse (USD value -> INR)."""
    usd = get_fx_rate("INR", "USD", fetch=_fetch_from_sample(sample_table))
    assert usd == pytest.approx(1.0 / sample_table["USD"])
    sgd = get_fx_rate("INR", "SGD", fetch=_fetch_from_sample(sample_table))
    assert sgd == pytest.approx(1.0 / sample_table["SGD"])


def test_one_fetch_per_run_for_many_quotes(sample_table):
    """The 'one rate per run' rule: several quotes share a single fetch."""
    calls: list[str] = []

    def counting_fetch(base: str, source: str) -> dict[str, float]:
        calls.append((base, source))
        return sample_table

    rates = get_fx_rates("INR", ["USD", "SGD"], fetch=counting_fetch)
    assert len(calls) == 1
    assert rates["USD"] == pytest.approx(1.0 / sample_table["USD"])
    assert rates["SGD"] == pytest.approx(1.0 / sample_table["SGD"])

    # A second call in the same run hits the cache - still exactly one fetch.
    again = get_fx_rates("INR", ["USD", "SGD", "USD"], fetch=counting_fetch)
    assert len(calls) == 1
    assert again == rates


def test_missing_quote_raises(sample_table):
    with pytest.raises(FXError, match="no rate for 'XXX'"):
        get_fx_rate("INR", "XXX", fetch=_fetch_from_sample(sample_table))


def test_empty_table_raises():
    """An injected table without the quote is a hard error, never a silent 1.0."""

    def bad_fetch(base: str, source: str) -> dict[str, float]:
        return {}

    with pytest.raises(FXError, match="no rate for 'USD'"):
        get_fx_rate("INR", "USD", fetch=bad_fetch)
