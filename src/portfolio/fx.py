"""Foreign exchange: one rate per run, persisted to fx_rates (M2).

Source: open.er-api.com (free, keyless, deterministic). One HTTP call to
`/v6/latest/<base>` returns the whole rate table, so a run that needs USD and
SGD performs exactly ONE fetch - that is the "one rate per run" rule.

Why a process-wide cache? A snapshot run is a single process, and several call
sites need the same rate (db.persist.persist for value_base, and the --all
allocation). Without the cache each call would re-fetch and two calls seconds
apart could return different rates, silently corrupting a run's internal
consistency (value_base in the position row vs. the allocation row).
Cache keyed by (base, quote) -> identical input, identical output.

Contract: rate(base, quote) is the multiplier R such that
    value_in_base = value_in_quote * R
With base=INR and the /latest/INR response, rates[USD] is "1 INR in USD", so
R = 1 / rates[quote] (1 USD = 95.14 INR, not 0.0105).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

import httpx

from portfolio.config import Settings

logger = logging.getLogger("portfolio.fx")

FX_ERROR = "fx"

# Process-wide cache: one fetch per (base, quote) per process == one per run.
_RATE_CACHE: dict[tuple[str, str], float] = {}
# The single fetch that populated the cache (for tests / diagnostics).
_CACHED_SOURCE: str | None = None

# Overridable in tests to serve the pinned sample without network.
FetchFn = Callable[[str, str], dict[str, float]]


def _fetch_rates_from_source(base: str, source: str) -> dict[str, float]:
    """Fetch the rate table `1 <base> = <rate> <currency>` from the source.

    Raises FXError on any failure: a run without FX cannot compute value_base,
    so it must fail loudly (and land in `runs` as an error) rather than proceed
    with a guessed or stale rate.
    """
    url = f"https://{source}/v6/latest/{base}"
    try:
        resp = httpx.get(url, timeout=15)
        resp.raise_for_status()
        payload: dict[str, Any] = resp.json()
    except httpx.HTTPError as exc:
        raise FXError(f"FX fetch failed for {base}: {exc}") from exc
    if payload.get("result") != "success" or not isinstance(payload.get("rates"), dict):
        raise FXError(f"FX source returned an unexpected payload for {base}: {str(payload)[:200]}")
    return {str(k): float(v) for k, v in payload["rates"].items() if isinstance(v, (int, float))}


def get_fx_rates(
    base: str,
    quotes: list[str],
    *,
    source: str | None = None,
    fetch: FetchFn | None = None,
) -> dict[str, float]:
    """Return {quote: rate} for one run - at most ONE network fetch per process.

    `fetch` is injectable for tests (defaults to the real er-api call).
    """
    global _CACHED_SOURCE
    source = source or Settings().fx_source
    quotes = [q for q in quotes if q != base]
    if not quotes:
        return {}

    missing = [q for q in quotes if (base, q) not in _RATE_CACHE]
    if missing:
        fetcher = fetch or _fetch_rates_from_source
        table = fetcher(base, source)
        for quote in missing:
            if quote not in table:
                raise FXError(f"FX source for {base} has no rate for {quote!r}")
            # table[quote] = "1 base in quote"; our contract is the inverse.
            _RATE_CACHE[(base, quote)] = 1.0 / table[quote]
        _CACHED_SOURCE = source
        logger.info("fetched FX table for %s from %s (%d rates)", base, source, len(table))
    return {q: _RATE_CACHE[(base, q)] for q in quotes}


def get_fx_rate(base: str, quote: str, *, fetch: FetchFn | None = None) -> float:
    """Return the single run-wide rate to convert `quote` value into `base`."""
    if base == quote:
        return 1.0
    rates = get_fx_rates(base, [quote], fetch=fetch)
    return rates[quote]


def reset_fx_cache() -> None:
    """Clear the process-wide cache (tests only - a fresh process needs no reset)."""
    _RATE_CACHE.clear()
    global _CACHED_SOURCE
    _CACHED_SOURCE = None


class FXError(Exception):
    """A run cannot proceed because a required FX rate is unavailable."""
