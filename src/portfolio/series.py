"""Derived portfolio value series (M-3 fix).

The `portfolio_value` table was written per leg into a UNIQUE(value_date,
is_eod, scope_type, scope_key) slot, so "the last writer wins" - live proof:
2026-06-30 `all` == the groww batch only, 2026-08-07 `all` omitted the whole
CAS leg. Incremental writes of a sum-that-isn't can never be fixed, so the
dashboard history is DERIVED at export time from `position_snapshot` instead:

    value(scope, date D) = SUM(market_value_base) of the position_snapshot
                           rows dated D that belong to scope

This is honest by construction with mixed-frequency legs: on a date where only
Zerodha ran, `all` = the Zerodha sum for that date and the other platforms have
no row (their array slot is 0.0 so chart series stay aligned by index).

Deterministic: dates ascending, platforms/geographies sorted, values in the
global base (market_value_base is frozen at each run's fx rate).
"""

from __future__ import annotations

from typing import Any


def portfolio_series(conn: Any, base: str) -> dict[str, Any]:
    """Derive per-scope daily portfolio values from position_snapshot.

    `base` is the consolidation currency (INR) - informational here, because
    market_value_base is already converted to it at write time.

    Returns arrays aligned by date index:
        {dates: [...], portfolioValueBase: [...],
         byGeography: {IN: [...], US: [...]}, byPlatform: {p: [...]}}
    """
    rows = conn.execute(
        """
        SELECT ps.snapshot_date AS d, i.platform AS p, i.geography AS g,
               SUM(ps.market_value_base) AS v
        FROM position_snapshot ps
        JOIN instrument i ON i.id = ps.instrument_id
        GROUP BY ps.snapshot_date, i.platform, i.geography
        ORDER BY ps.snapshot_date, i.platform, i.geography
        """
    ).fetchall()

    dates: list[str] = []
    total: list[float] = []
    by_platform: dict[str, list[float]] = {}
    by_geography: dict[str, list[float]] = {}
    index: dict[str, int] = {}

    for r in rows:
        day = r["d"]
        i = index.setdefault(day, len(dates))
        if i == len(dates):  # a new date: every existing series gets a 0.0 slot
            dates.append(day)
            total.append(0.0)
            for series in list(by_platform.values()) + list(by_geography.values()):
                series.append(0.0)
        total[i] += r["v"]
        # setdefault creates the series at the CURRENT length (which includes
        # the new date), then the += fills this row's slot.
        by_platform.setdefault(r["p"], [0.0] * len(dates))[i] += r["v"]
        by_geography.setdefault(r["g"], [0.0] * len(dates))[i] += r["v"]

    def _rounded(values: list[float]) -> list[float]:
        return [round(v, 2) for v in values]

    return {
        "dates": dates,
        "portfolioValueBase": _rounded(total),
        "byGeography": {k: _rounded(v) for k, v in sorted(by_geography.items())},
        "byPlatform": {k: _rounded(v) for k, v in sorted(by_platform.items())},
    }
