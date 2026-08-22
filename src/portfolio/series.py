"""Derived portfolio value series (M-3 fix).

The `portfolio_value` table was written per leg into a UNIQUE(value_date,
is_eod, scope_type, scope_key) slot, so "the last writer wins" - live proof:
2026-06-30 `all` == the groww batch only, 2026-08-07 `all` omitted the whole
CAS leg. Incremental writes of a sum-that-isn't can never be fixed, so the
dashboard history is DERIVED at export time from `position_snapshot` instead:

    value(scope, date D) = SUM(market_value_base) of the position_snapshot
                           rows dated D that belong to scope

This is honest by construction with mixed-frequency legs: on a date where only
Zerodha ran, the other platforms retain their most recent known value. A
missing row means that a leg did not run, not that its holdings disappeared.
This assumes each platform snapshot date is a complete replacement snapshot for
that platform: all instruments held by the platform on that date are present,
so an absent platform date means its complete prior aggregate should carry.

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

    if not rows:
        return {
            "dates": [],
            "portfolioValueBase": [],
            "byGeography": {},
            "byPlatform": {},
        }

    dates = sorted({r["d"] for r in rows})
    platforms = sorted({r["p"] for r in rows})

    # A platform is expected to have one geography in the common schema. Keep
    # the mapping explicit and stable rather than deriving geography from the
    # carried values themselves. The first ordered mapping is deterministic for
    # legacy/malformed data with conflicting instrument metadata.
    platform_geography: dict[str, str] = {}
    for r in rows:
        platform_geography.setdefault(r["p"], r["g"])

    dated_totals: dict[tuple[str, str], float] = {
        (r["d"], r["p"]): r["v"] for r in rows
    }
    # A platform snapshot is a complete replacement snapshot. Carry the
    # platform aggregate only when that platform has no rows on this date.
    carried: dict[str, float] = {platform: 0.0 for platform in platforms}
    platform_values: dict[str, list[float]] = {platform: [] for platform in platforms}
    geography_values: dict[str, list[float]] = {
        geography: [] for geography in sorted(set(platform_geography.values()))
    }
    totals: list[float] = []

    for day in dates:
        for platform in platforms:
            if (day, platform) in dated_totals:
                carried[platform] = dated_totals[(day, platform)]
            platform_values[platform].append(round(carried[platform], 2))

        # Build both aggregate levels from the same rounded platform values.
        # This avoids a one-cent disagreement caused by independently rounding
        # the total and its components.
        for geography in geography_values:
            geography_values[geography].append(
                round(
                    sum(
                        platform_values[platform][-1]
                        for platform in platforms
                        if platform_geography[platform] == geography
                    ),
                    2,
                )
            )
        totals.append(round(sum(platform_values[platform][-1] for platform in platforms), 2))

    return {
        "dates": dates,
        "portfolioValueBase": totals,
        "byGeography": geography_values,
        "byPlatform": platform_values,
    }
