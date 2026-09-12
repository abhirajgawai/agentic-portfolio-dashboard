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
This assumes each ACCOUNT's snapshot date is a complete replacement snapshot
for that account: all instruments held by the account on that date are
present, so an absent account date means its complete prior aggregate should
carry. Carry-forward is per (platform, account_ref), not per platform alone -
a platform can have multiple independently-scheduled accounts (e.g. groww's
automated CAS folio import vs. a hand-entered manual equities total), and
treating the platform as one unit would let one account's snapshot day
silently replace the WHOLE platform's total, discarding every other account
under it (real bug found 2026-08-26: a manual Groww equities update on a day
the CAS folio import didn't also run dropped 27.75L from that day's total -
verified live, ledger showed 75L against a real 1.03Cr net worth).

Deterministic: dates ascending, platforms/geographies sorted, values in the
global base (market_value_base is frozen at each run's fx rate).
"""

from __future__ import annotations

from typing import Any

from portfolio.config import PLATFORMS


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
        SELECT ps.snapshot_date AS d, a.platform AS p, i.geography AS g,
               a.account_ref AS ref, SUM(ps.market_value_base) AS v
        FROM position_snapshot ps
        JOIN account a ON a.id = ps.account_id
        JOIN instrument i ON i.id = ps.instrument_id
        GROUP BY ps.snapshot_date, a.platform, i.geography, a.account_ref
        ORDER BY ps.snapshot_date, a.platform, a.account_ref
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
    # Platform-complete by construction, not just "whatever has history rows
    # today": the dashboard's CAS segment (segments.ts) sums byPlatform.groww
    # + byPlatform.sharekhan unconditionally, and a platform legitimately can
    # have zero position_snapshot rows (e.g. right after a data reset, or a
    # leg that has never run yet) without that key vanishing from the export -
    # a missing key reads as "broken export" downstream, a present zero-filled
    # array reads as "no data yet", which is what's actually true.
    platforms = sorted(set(PLATFORMS) | {r["p"] for r in rows})

    # A platform is expected to have one geography in the common schema. Known
    # platforms take their geography from the registry (authoritative, and
    # available even with zero rows); the first-observed row is the fallback
    # for any platform absent from the registry (defensive - shouldn't happen).
    platform_geography: dict[str, str] = {}
    for r in rows:
        platform_geography.setdefault(r["p"], r["g"])
    for platform in platforms:
        if platform in PLATFORMS:
            platform_geography[platform] = PLATFORMS[platform]["geography"]
        else:
            platform_geography.setdefault(platform, "IN")

    # The carry-forward UNIT is (platform, account_ref) - each account's
    # snapshot is a complete replacement for that account only. A platform
    # with zero rows still gets one placeholder account so it appears
    # zero-filled in platform_values below, matching the registry-complete
    # guarantee above.
    accounts: set[tuple[str, str]] = {(r["p"], r["ref"]) for r in rows}
    observed_platforms = {p for p, _ in accounts}
    for platform in platforms:
        if platform not in observed_platforms:
            accounts.add((platform, ""))

    dated_totals: dict[tuple[str, str, str], float] = {
        (r["d"], r["p"], r["ref"]): r["v"] for r in rows
    }
    carried: dict[tuple[str, str], float] = {acc: 0.0 for acc in accounts}
    account_values: dict[tuple[str, str], list[float]] = {acc: [] for acc in accounts}
    platform_values: dict[str, list[float]] = {platform: [] for platform in platforms}
    geography_values: dict[str, list[float]] = {
        geography: [] for geography in sorted(set(platform_geography.values()))
    }
    totals: list[float] = []

    for day in dates:
        for acc in accounts:
            platform, ref = acc
            if (day, platform, ref) in dated_totals:
                carried[acc] = dated_totals[(day, platform, ref)]
            account_values[acc].append(round(carried[acc], 2))

        # Platform totals sum ALL of that platform's accounts' (possibly
        # carried) values for this day - the fix: one account updating never
        # replaces another account's carried value under the same platform.
        for platform in platforms:
            platform_values[platform].append(
                round(
                    sum(account_values[acc][-1] for acc in accounts if acc[0] == platform),
                    2,
                )
            )

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

    # Per-account breakdown (M-5): account_values already carries this at full
    # daily granularity (built above for the carry-forward fix), but was never
    # returned - a platform with multiple independently-tracked accounts (e.g.
    # groww's automated CAS folio import vs. its hand-entered manual equities
    # total) had no way to chart those two legs separately, only their summed
    # byPlatform total. Keyed "platform:account_ref"; single-account platforms
    # (a bare "" account_ref, e.g. zerodha) are omitted here since byPlatform
    # already IS that one account's series - exporting "zerodha:" would just
    # duplicate byPlatform.zerodha under an uglier key.
    # sorted(): `accounts` is a set, so its (and account_values'/its dict-
    # comprehension's) iteration order is not guaranteed stable across
    # separate process runs (only within one) - sort explicitly, matching
    # this file's own "platforms/geographies sorted" determinism guarantee.
    by_account: dict[str, list[float]] = {
        f"{platform}:{ref}": account_values[(platform, ref)]
        for platform, ref in sorted(accounts)
        if ref
    }

    return {
        "dates": dates,
        "portfolioValueBase": totals,
        "byGeography": geography_values,
        "byPlatform": platform_values,
        "byAccount": by_account,
    }
