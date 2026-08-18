"""Daily performance layer (M8.6): day P&L, returns, attribution, revaluations.

The daily ledger (`position_snapshot`) answers "what was holding X worth on date
D". This module answers the harder question: WHY did value move? The answer is
an INTERVAL RULE over each holding's consecutive snapshot rows:

  - no previous row                 -> revaluation event kind `first_appearance`
  - gap <= 7 days                   -> DAILY MOVE (day P&L, base)
  - gap > 7 days                    -> revaluation event (kind by platform:
                                       `property` for real_estate,
                                       `cas_import` for groww/sharekhan, else
                                       `other`) with intervalDays = the gap

A gap > 7 days means the value changed because DATA changed (a monthly CAS
import re-priced a fund, a property was revalued, a holding was first seen),
not because the market moved. Mixing those into day P&L would make a month-old
NAV jump look like a one-day crash - the same mixed-frequency honesty problem
M-3 solved for the value series. First appearances and revaluations are tracked
in `revaluationEvents`; only daily moves reach `dayPnlBase` and attribution.

Broker day P&L is a SEPARATE measure: each row's `day_change_ccy` (the broker's
own number) is converted to base with that row's own frozen ratio
market_value_base / market_value_ccy - the same rate the value was written at,
so there is no second FX fetch and no FX noise. Only live legs (zerodha/moomoo)
carry day_change_ccy; CAS/property rows leave the broker map absent.

Determinism boundary (guardrail #4): the engine is pure/read-only. `today` is
injected - the module never reads a clock. Naive datetimes are refused loudly
(a naive clock would silently shift market dates); malformed `today` degrades
to an empty payload (missing data, never a crash). Identical input -> identical
output: dates ascending, scope keys sorted, movers/revaluations sorted by
|change| desc with ticker/platform tiebreaks, all values rounded to 2dp.

The M3.5 reconciliation invariant: per date, sum(attribution.byGeography) ==
sum(byPlatform) == sum(byAssetClass) == dayPnlBase (each is a partition of the
same per-holding daily moves). The per-date ledger identity
valueBase(D) - valueBase(D-1) == dayPnlBase(D) + sum(revaluationEvents(D))
holds when the set of holdings with rows is stable between consecutive ledger
dates; a holding that drops out between dates (e.g. a 2-day moomoo leg in a
3-day window) breaks it honestly - the base series and the P&L series then
measure different holding sets. The tests pin both invariants.
"""

from __future__ import annotations

from datetime import date, datetime
from math import isfinite
from typing import Any

from portfolio.returns import account_xirrs, portfolio_simple_return

# Revaluation boundary (calendar days between consecutive snapshot rows).
# Gaps <= 7 days are daily moves; longer gaps are revaluation events.
REVAL_GAP_DAYS = 7

# Platforms whose >7-day gaps are `cas_import` revaluations (monthly CAS).
_CAS_PLATFORMS = ("groww", "sharekhan")


def _as_date(value: str | date | datetime) -> date:
    """ISO date strings / dates / AWARE datetimes -> date.

    Naive datetimes are refused loudly (a naive clock would silently shift
    market dates); anything else unparseable -> ValueError, which callers
    degrade to "missing" - never a crash.
    """
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError(f"naive datetime refused (must be timezone-aware): {value!r}")
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _reval_kind(platform: str) -> str:
    """Kind bucket for a >7-day gap: property / cas_import / other."""
    if platform == "real_estate":
        return "property"
    if platform in _CAS_PLATFORMS:
        return "cas_import"
    return "other"


def _empty_payload(today: str) -> dict[str, Any]:
    """A valid payload with no data (fresh DB, or a malformed injected today).

    The table rebuild helper consumes `_scopes`; an empty list empties the
    table, which is the correct "no data" state. `asOf` is added by the
    export caller (the engine never reads a clock).
    """
    return {
        "daily": [],
        "xirr": {"asOf": "", "perAccount": {}},
        "_scopes": [],
    }


def daily_performance(conn: Any, *, today: str | date | datetime) -> dict[str, Any]:
    """Derive the daily performance payload (pinned M8.6 contract) from the ledger.

    `today` is the market-date cutoff (injected by the caller - the engine
    never reads a clock): rows dated after it are excluded. Malformed `today`
    (unparseable string) degrades to an empty payload; a naive datetime raises.

    Returns the pinned performance.json payload plus a private `_scopes` list
    (one dict per (perf_date, scope_type, scope_key) table row - the same data
    the export rebuilds into `daily_performance` with `rebuild_table`). The
    export strips `_scopes` before writing the file; `xirr.asOf` is the
    injected `today` (the XIRR terminal flow is dated exactly `today`).
    """
    # Naive datetimes are refused LOUDLY (before the malformed-date handler):
    # a naive clock would silently shift market dates, and silently treating
    # it as "missing" would hide the caller's bug. Garbage STRINGS are real
    # missing data and degrade to the empty payload.
    if isinstance(today, datetime) and (today.tzinfo is None or today.utcoffset() is None):
        raise ValueError(f"naive datetime refused (must be timezone-aware): {today!r}")
    try:
        today_d = _as_date(today)
    except (ValueError, TypeError):
        return _empty_payload(str(today))
    today_iso = today_d.isoformat()

    rows = conn.execute(
        """
        SELECT ps.snapshot_date AS d, ps.account_id AS acc, ps.instrument_id AS inst,
               ps.market_value_base AS mv, ps.market_value_ccy AS mvccy,
               ps.day_change_ccy AS dccy, ps.cost_value_base AS cost,
               i.ticker, i.name, i.platform, i.geography, i.asset_class, i.currency
        FROM position_snapshot ps
        JOIN instrument i ON i.id = ps.instrument_id
        WHERE ps.snapshot_date <= ?
        ORDER BY ps.account_id, ps.instrument_id, ps.snapshot_date
        """,
        (today_iso,),
    ).fetchall()

    # Per-(account, instrument) previous row: (snapshot_date, market_value_base).
    prev_by_holding: dict[tuple[int, int], tuple[str, float]] = {}
    dates: set[str] = set()
    # scopes[date][(scope_type, scope_key)] -> aggregate dict.
    scopes: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}
    revals: dict[str, list[dict[str, Any]]] = {}  # date -> revaluation events
    movers: dict[str, list[dict[str, Any]]] = {}  # date -> per-holding daily moves
    fx_cache: dict[str, int | None] = {}

    for r in rows:
        day = str(r["d"])
        dates.add(day)
        inst_key = (int(r["acc"]), int(r["inst"]))
        mv = float(r["mv"])
        prev = prev_by_holding.get(inst_key)
        move = 0.0
        if prev is None:
            # First row for this holding: the whole value is new money in the
            # ledger, never a market move.
            revals.setdefault(day, []).append(
                {
                    "ticker": str(r["ticker"]),
                    "name": r["name"],
                    "platform": str(r["platform"]),
                    "changeBase": mv,
                    "intervalDays": None,
                    "kind": "first_appearance",
                }
            )
        else:
            prev_day, prev_value = prev
            gap = (date.fromisoformat(day) - date.fromisoformat(prev_day)).days
            if gap <= REVAL_GAP_DAYS:
                move = mv - prev_value  # a genuine daily market move
            else:
                revals.setdefault(day, []).append(
                    {
                        "ticker": str(r["ticker"]),
                        "name": r["name"],
                        "platform": str(r["platform"]),
                        "changeBase": mv - prev_value,
                        "intervalDays": gap,
                        "kind": _reval_kind(str(r["platform"])),
                    }
                )
        prev_by_holding[inst_key] = (day, mv)

        # Broker-reported day P&L -> base via THIS row's frozen value ratio
        # (market_value_base / market_value_ccy): no second FX fetch, no noise.
        broker = None
        if r["dccy"] is not None and r["mvccy"]:
            broker = float(r["dccy"]) * (mv / float(r["mvccy"]))

        # Distribute the row into every scope it belongs to. 'all' is the
        # portfolio-wide row (scope_key ''); the rest split by holding metadata.
        geography = str(r["geography"] or "unknown")
        platform = str(r["platform"])
        asset_class = str(r["asset_class"] or "unknown")
        currency = str(r["currency"])
        cost = r["cost"]
        for stype, skey in (
            ("all", ""),
            ("geography", geography),
            ("platform", platform),
            ("asset_class", asset_class),
            ("currency", currency),
        ):
            rec = scopes.setdefault(day, {}).setdefault(
                (stype, skey),
                {
                    "value": 0.0,
                    "day": 0.0,
                    "broker": 0.0,
                    "broker_any": False,
                    "cost_with": 0,
                    "cost_without": 0,
                    "cost_total": 0.0,
                    "mkt_total": 0.0,
                },
            )
            rec["value"] += mv
            rec["day"] += move
            if broker is not None:
                rec["broker"] += broker
                rec["broker_any"] = True
            if cost is None:
                rec["cost_without"] += 1
            else:
                rec["cost_with"] += 1
                rec["cost_total"] += float(cost)
                rec["mkt_total"] += mv

        if move != 0.0:
            movers.setdefault(day, []).append(
                {
                    "ticker": str(r["ticker"]),
                    "name": r["name"],
                    "platform": platform,
                    "geography": geography,
                    "dayPnlBase": move,
                    "valueBase": mv,
                }
            )

    def _fx_rate_id(day: str) -> int | None:
        """First fx_rate row dated `day` (deterministic: MIN id); None when the
        date has no rate rows (INR-only days) - the values are already in base."""
        if day not in fx_cache:
            row = conn.execute(
                "SELECT id FROM fx_rate WHERE rate_date = ? ORDER BY id LIMIT 1", (day,)
            ).fetchone()
            fx_cache[day] = row["id"] if row is not None else None
        return fx_cache[day]

    def _pct(day_pnl: float, prev_value: float) -> float | None:
        """dayPnl / previous-day value * 100; None when no prev value to divide."""
        if prev_value == 0.0 or not isfinite(prev_value):
            return None
        return day_pnl / prev_value * 100.0

    ordered_dates = sorted(dates)
    daily: list[dict[str, Any]] = []
    scope_rows: list[dict[str, Any]] = []
    for i, day in enumerate(ordered_dates):
        day_scopes = scopes.get(day, {})
        all_rec = day_scopes[("all", "")]
        prev_value_all = 0.0
        if i > 0:
            prev_all = scopes.get(ordered_dates[i - 1], {}).get(("all", ""))
            prev_value_all = prev_all["value"] if prev_all else 0.0

        # brokerDayPnl: per-platform sums, only platforms carrying day_change_ccy.
        broker_by_platform = {
            key[1]: rec["broker"]
            for key, rec in sorted(day_scopes.items())
            if key[0] == "platform" and rec["broker_any"]
        }

        # XIRR-style simple return over cost-bearing rows only (M5 semantics:
        # NULL/zero cost total -> None, never a crash).
        simple = portfolio_simple_return(all_rec["cost_total"], all_rec["mkt_total"])

        day_revals = sorted(
            revals.get(day, []),
            key=lambda e: (-abs(e["changeBase"]), e["ticker"], e["platform"]),
        )[:10]
        day_movers = sorted(
            movers.get(day, []),
            key=lambda m: (-abs(m["dayPnlBase"]), m["ticker"], m["platform"]),
        )[:10]

        daily.append(
            {
                "date": day,
                "valueBase": round(all_rec["value"], 2),
                "dayPnlBase": round(all_rec["day"], 2),
                "brokerDayPnl": {
                    k: round(v, 2) for k, v in broker_by_platform.items()
                },
                "dayPnlPct": _round_pct(_pct(all_rec["day"], prev_value_all)),
                "simpleReturnPct": round(simple * 100.0, 2) if simple is not None else None,
                "costCoverage": {
                    "withCost": all_rec["cost_with"],
                    "noCost": all_rec["cost_without"],
                },
                "attribution": {
                    "byGeography": {
                        k: round(v, 2)
                        for k, v in sorted(
                            (key[1], rec["day"])
                            for key, rec in day_scopes.items()
                            if key[0] == "geography"
                        )
                    },
                    "byPlatform": {
                        k: round(v, 2)
                        for k, v in sorted(
                            (key[1], rec["day"])
                            for key, rec in day_scopes.items()
                            if key[0] == "platform"
                        )
                    },
                    "byAssetClass": {
                        k: round(v, 2)
                        for k, v in sorted(
                            (key[1], rec["day"])
                            for key, rec in day_scopes.items()
                            if key[0] == "asset_class"
                        )
                    },
                },
                "topMovers": [
                    {**m, "dayPnlBase": round(m["dayPnlBase"], 2), "valueBase": round(m["valueBase"], 2)}
                    for m in day_movers
                ],
                "revaluationEvents": [
                    {**e, "changeBase": round(e["changeBase"], 2)} for e in day_revals
                ],
            }
        )

        # One table scope row per (date, scope_type, scope_key) - the same
        # aggregates the export rebuilds into daily_performance. Sorted for
        # determinism; day_pnl_pct uses each scope's own previous-day value.
        for (stype, skey), rec in sorted(day_scopes.items()):
            prev_value = 0.0
            if i > 0:
                prev_rec = scopes.get(ordered_dates[i - 1], {}).get((stype, skey))
                prev_value = prev_rec["value"] if prev_rec else 0.0
            scope_simple = portfolio_simple_return(rec["cost_total"], rec["mkt_total"])
            scope_rows.append(
                {
                    "perf_date": day,
                    "scope_type": stype,
                    "scope_key": skey,
                    "value_base": round(rec["value"], 2),
                    "day_pnl_base": round(rec["day"], 2),
                    "broker_day_pnl_base": round(rec["broker"], 2) if rec["broker_any"] else None,
                    "day_pnl_pct": _round_pct(_pct(rec["day"], prev_value)),
                    "simple_return_pct": round(scope_simple * 100.0, 2)
                    if scope_simple is not None
                    else None,
                    "cost_with": rec["cost_with"],
                    "cost_without": rec["cost_without"],
                    "fx_rate_id": _fx_rate_id(day),
                }
            )

    # XIRR: reuse the M5 reader with the SAME injected today (terminal flow
    # dated `today`, never before the last trade). No trades -> empty map.
    per_account: dict[str, dict[str, Any]] = {}
    for acc in account_xirrs(conn, today=today_iso).values():
        per_account[acc.key] = {
            "currency": acc.currency,
            "xirrPct": round(acc.xirr_rate * 100.0, 4) if acc.xirr_rate is not None else None,
            "terminalValue": round(acc.terminal_value, 2),
            "flowCount": acc.flow_count,
        }

    return {
        "daily": daily,
        "xirr": {"asOf": today_iso, "perAccount": per_account},
        "_scopes": scope_rows,
    }


def _round_pct(pct: float | None) -> float | None:
    """Round a percentage to 2dp, preserving None (missing, never a crash)."""
    return round(pct, 2) if pct is not None else None


def rebuild_table(conn: Any, payload: dict[str, Any], rebuilt_at: str) -> int:
    """DELETE-all + INSERT the payload's scope rows into `daily_performance`.

    Idempotent and deterministic: a second rebuild with the same payload writes
    the same rows (DELETE-first + UNIQUE(perf_date, scope_type, scope_key)).
    Returns the number of scope rows inserted.

    `payload` MUST be `daily_performance()` output - it carries the private
    `_scopes` list (one dict per table row). The engine is the single source
    of truth for the scope math; this helper is a dumb materializer, so the
    table can never drift from the payload (the M3.5 reconciliation invariant
    is preserved in the table by construction).
    """
    scope_rows = payload.get("_scopes")
    if scope_rows is None:
        raise ValueError(
            "payload missing '_scopes' - rebuild_table requires daily_performance() output"
        )
    conn.execute("DELETE FROM daily_performance")
    count = 0
    for s in scope_rows:
        conn.execute(
            "INSERT INTO daily_performance (perf_date, scope_type, scope_key,"
            " value_base, day_pnl_base, broker_day_pnl_base, day_pnl_pct,"
            " simple_return_pct, cost_with, cost_without, fx_rate_id, rebuilt_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                s["perf_date"],
                s["scope_type"],
                s["scope_key"],
                s["value_base"],
                s["day_pnl_base"],
                s["broker_day_pnl_base"],
                s["day_pnl_pct"],
                s["simple_return_pct"],
                s["cost_with"],
                s["cost_without"],
                s["fx_rate_id"],
                rebuilt_at,
            ),
        )
        count += 1
    conn.commit()
    return count
