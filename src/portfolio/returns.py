"""Returns & XIRR (M5): simple returns + a pure-Python XIRR solver.

Determinism boundary: every function here is pure or read-only. Inputs are
injected (dates, flows, series) or come from read-only DB queries; the solver
never reads a clock - callers pass `today`/`as_of`. No randomness, fixed
precision + iteration caps.

XIRR solves sum(cf_i / (1+r)^(t_i/365)) = 0 for the annualized rate r, where
t_i = days from the FIRST flow date and the year is 365 days. The solver is
bisection on log-space (x = log(1+r) - handles r -> -1 and large r) with a
Newton polish, converges to `precision` (default 1e-9), and rounds the output
to 4 decimals. Returns None (never raises) when no solution exists.

Cash-flow convention (VERIFIED against the trades.py writers + the
writer.upsert_trade docstring "SIGNED (+buy / -sell) - the XIRR solver reads
them as cash flows"): trade.amount_ccy is stored +BUY / -SELL, so the XIRR
flow is `-amount_ccy` - a BUY (outflow, -|amount|) and a SELL (inflow,
+|amount|) both follow from the stored sign. The terminal flow is the
account's current position value in the flow currency (+value, as if
liquidated, on the run's `today`).

Consolidated cross-currency XIRR is OUT OF SCOPE: there is no complete
historical FX for backfilled trades, so XIRR is per (account, FLOW currency)
- zerodha INR, moomoo USD - and flows/terminal are never converted.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

# exp clamping bounds for the log-space NPV: exp(709) ~= 8.8e307 (near the
# float max) and exp(-745) underflows to subnormal noise. Beyond these, only
# the SIGN of a dominating term matters for bracketing.
_EXP_MAX = 709.0
_EXP_MIN = -745.0


def _usable(value: float | None) -> bool:
    """A value is usable for a ratio when it is a finite, non-zero number."""
    try:
        return value is not None and math.isfinite(value) and value != 0
    except TypeError:
        return False


def _ratio(cost_value: float | None, current_value: float | None) -> float | None:
    """(current - cost) / cost with the None/zero/NaN guards - the simple-return core."""
    if not _usable(cost_value) or not _usable(current_value):
        return None
    return (current_value - cost_value) / cost_value


def per_holding_return(cost_value: float | None, current_value: float | None) -> float | None:
    """Simple per-holding return (current - cost) / cost.

    NULL/zero cost (the M3 CAS demat MFs + Sharekhan equities are value-only)
    or a missing current value -> None, never a crash.
    """
    return _ratio(cost_value, current_value)


def portfolio_simple_return(cost_value: float | None, current_value: float | None) -> float | None:
    """Portfolio simple return over ONE-currency aggregates:
    (sum(current) - sum(cost)) / sum(cost). Same None semantics; the caller
    sums per-currency (or base-converted) totals before calling.
    """
    return _ratio(cost_value, current_value)


def _as_date(value: str | date | datetime) -> date:
    """Accept ISO date strings, dates, and datetimes (datetime.first - it
    subclasses date). Anything else -> ValueError surface as None from callers."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def series_change_pct(series: dict[str, Any], days: int) -> float | None:
    """Portfolio % change over the trailing `days` calendar days.

    Compares the LATEST series value to the latest value at or before
    (last_date - days) - honest with mixed-frequency legs: a gap picks the
    newest point inside the window instead of pretending a 45-day span is a
    "1-day" move. Returns None (never raises) when the history is too short
    for the window or the reference value is zero/missing.
    """
    dates = series.get("dates") or []
    values = series.get("portfolioValueBase") or []
    if not dates or len(dates) != len(values):
        return None
    try:
        last_date = date.fromisoformat(dates[-1])
        cutoff = last_date - timedelta(days=days)
    except (ValueError, TypeError):
        return None
    ref: float | None = None
    for raw_day, v in zip(dates, values, strict=True):
        try:
            day = date.fromisoformat(raw_day)
        except (ValueError, TypeError):
            continue
        if day <= cutoff:
            ref = v  # keep the latest point at or before the cutoff
    if ref is None or not _usable(ref):
        return None
    latest = values[-1]
    if not _usable(latest):
        return None
    return (latest - ref) / ref * 100.0


# ---- XIRR -------------------------------------------------------------------


def xirr(
    flows: list[tuple[str | date | datetime, float]],
    *,
    precision: float = 1e-9,
    max_iter: int = 200,
) -> float | None:
    """Solve sum(cf_i / (1+r)^(t_i/365)) = 0 for the ANNUALIZED rate r.

    `flows` = [(date, amount), ...], ANY order; amounts are SIGNED from the
    investor's pocket (-outflow like buys, +inflow like sells/terminal).
    The first flow date is t=0; same-date flows merge before solving.

    Algorithm: bisection on x = log(1+r) (log-space keeps r > -1 and huge r
    well-behaved), then a Newton polish with the analytic derivative. The NPV
    is exponent-clamped so extreme x can never overflow (only sign matters out
    there). Deterministic: `max_iter` caps both loops, converges to
    `precision`, output rounded to 4 decimals.

    Returns None (never raises) for inputs with no solution:
    - fewer than 2 non-zero flows,
    - all flows one sign,
    - no time spread (degenerate: every r or no r solves),
    - no sign change within the expanded/clamped search range,
    - a non-finite converged rate.
    """
    # Normalize: drop zero flows, parse dates (garbage -> None, never raise),
    # sort, merge same-date flows.
    parsed: list[tuple[date, float]] = []
    for d, c in flows:
        if c == 0:
            continue
        try:
            parsed.append((_as_date(d), c))
        except (ValueError, TypeError):
            return None  # unparseable date -> no solution, never raise
    sorted_flows = sorted(parsed)
    merged: list[tuple[date, float]] = []
    for d, c in sorted_flows:
        if merged and merged[-1][0] == d:
            merged[-1] = (d, merged[-1][1] + c)
        else:
            merged.append((d, c))
    if len(merged) < 2:
        return None

    cfs = [c for _, c in merged]
    if min(cfs) > 0.0 or max(cfs) < 0.0:
        return None  # all flows one sign -> the NPV can never cross zero
    days = [(d - merged[0][0]).days for d, _ in merged]
    if max(days) == 0:
        return None  # no time spread (defensive - merging already collapses same dates)

    d_max = max(days)
    # Numerically stabilized NPV: h(x) = sum(cf * exp(x*(d_max-d)/365)) has the
    # same root as the textbook sum (multiplied by exp(x*d_max/365) > 0) but
    # never overflows for x < 0, and the clamp keeps it finite for x > 0.
    def npv(x: float) -> float:
        total = 0.0
        for t_days, cf in zip(days, cfs, strict=True):
            exponent = (d_max - t_days) * x / 365.0
            if exponent > _EXP_MAX:
                total += cf * math.exp(_EXP_MAX)  # sign-preserving huge term
            elif exponent < _EXP_MIN:
                pass  # underflow - negligible
            else:
                total += cf * math.exp(exponent)
        return total

    def d_npv(x: float) -> float:
        total = 0.0
        for t_days, cf in zip(days, cfs, strict=True):
            exponent = (d_max - t_days) * x / 365.0
            if exponent < _EXP_MIN:
                continue
            factor = math.exp(_EXP_MAX) if exponent > _EXP_MAX else math.exp(exponent)
            total += cf * (d_max - t_days) / 365.0 * factor
        return total

    # Bracket: expand exponentially until NPV changes sign (or the cap).
    lo, hi = -1.0, 1.0
    f_lo, f_hi = npv(lo), npv(hi)
    step = 1.0
    for _ in range(max_iter):
        if f_lo == 0.0:
            return _round_rate(lo)
        if f_hi == 0.0:
            return _round_rate(hi)
        if f_lo * f_hi < 0.0:
            break
        lo -= step
        hi += step
        step *= 2.0
        f_lo, f_hi = npv(lo), npv(hi)
    else:  # no sign change within the expanded range -> no root found
        return None

    # Bisection to `precision` in log-space.
    for _ in range(max_iter):
        mid = (lo + hi) / 2.0
        if hi - lo < precision:
            break
        f_mid = npv(mid)
        if f_lo * f_mid < 0.0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid

    # Newton polish (bounded attempts; a degenerate/flat derivative keeps the
    # bisection point).
    x = (lo + hi) / 2.0
    for _ in range(6):
        fx = npv(x)
        dfx = d_npv(x)
        if dfx == 0.0 or not math.isfinite(dfx):
            break
        correction = fx / dfx
        if not math.isfinite(correction) or abs(correction) > 1.0:
            break
        x -= correction
    return _round_rate(x)


def _round_rate(x: float) -> float | None:
    """log-space rate -> annualized decimal rate rounded to 4 decimals."""
    if not math.isfinite(x):
        return None
    if abs(x) > 20.0:
        return None  # |log(1+r)| > 20 is no real investment rate (defensive)
    try:
        rate = math.expm1(x)  # exp(x) - 1: exact for tiny x, no 1.0-loss
    except OverflowError:
        return None
    if not math.isfinite(rate):
        return None
    return round(rate, 4)


# ---- DB-backed per-account XIRR ----------------------------------------------


@dataclass
class AccountXirr:
    """One (account, FLOW currency) XIRR computation (export diagnostics)."""

    key: str  # "<platform>__<account_ref>" - the dashboard perAccount key
    platform: str
    account_ref: str
    currency: str  # the FLOW currency (trade.currency): INR / USD
    xirr_rate: float | None  # annualized decimal rate, 4dp-rounded, or None
    terminal_value: float  # sum(position.market_value_ccy) for the group
    flow_count: int  # non-zero flows fed to the solver (trades + terminal)
    flows: list[tuple[str, float]] = field(default_factory=list)  # diagnostics


def account_xirrs(conn: Any, *, today: str | date) -> dict[str, AccountXirr]:
    """Read-only per-account XIRR: captured trades + current position value.

    Groups trades by (account_id, trade.currency) - the FLOW currency
    (zerodha INR, moomoo USD). Terminal value = sum(position.market_value_ccy)
    for that account+currency, dated `today` (never clamped to the machine
    clock: the caller is the clock owner). NEVER converts flows - cross-currency
    XIRR is out of scope (no complete historical FX for backfilled trades).

    Only (account, currency) groups with at least one captured trade appear;
    an account with trades but an unsolvable flow set still appears with
    xirr_rate=None (genuinely missing data is None, never a crash).
    """
    today_iso = _as_date(today).isoformat()

    acc_meta = {
        r["id"]: r
        for r in conn.execute(
            "SELECT id, platform, COALESCE(account_ref, '') AS account_ref FROM account"
        ).fetchall()
    }
    terminal: dict[tuple[int, str], float] = {}
    for r in conn.execute(
        """
        SELECT p.account_id AS acc, i.currency AS ccy, SUM(p.market_value_ccy) AS mv
        FROM position p
        JOIN instrument i ON i.id = p.instrument_id
        GROUP BY p.account_id, i.currency
        """
    ).fetchall():
        terminal[(r["acc"], r["ccy"])] = r["mv"] or 0.0

    groups: dict[tuple[int, str], list[tuple[str, float]]] = {}
    for r in conn.execute(
        """
        SELECT t.account_id AS acc, t.currency AS ccy, t.trade_date AS d, t.amount_ccy AS amt
        FROM trade t
        ORDER BY t.account_id, t.currency, t.trade_date
        """
    ).fetchall():
        # Stored amount_ccy is SIGNED +buy/-sell; the XIRR flow is -amount_ccy
        # (investment direction: buys are outflows, sells inflows). Verified
        # against trades.py writers; pinned by tests/test_returns.py fixtures.
        groups.setdefault((r["acc"], r["ccy"]), []).append((r["d"], -float(r["amt"])))

    result: dict[str, AccountXirr] = {}
    for (acc_id, ccy), flows in sorted(groups.items()):
        meta = acc_meta.get(acc_id)
        if meta is None:
            continue  # orphaned trade rows (should not exist; FK enforced)
        # Key must be unique per account even when account_ref is empty (the
        # zerodha writer stores no ref): fall back to the numeric id so two
        # same-platform accounts can never collide in the export dict.
        ref = meta["account_ref"] or str(acc_id)
        key = f"{meta['platform']}__{ref}"
        term_value = terminal.get((acc_id, ccy), 0.0)
        last_flow_date = max(_as_date(d) for d, _ in flows)
        # The terminal lands at `today` - but never BEFORE the last trade (a
        # stale `today` must not produce negative time).
        term_date = max(today_iso, last_flow_date.isoformat())
        all_flows = flows + [(term_date, term_value)]
        non_zero = [(d, c) for d, c in all_flows if c != 0]
        result[key] = AccountXirr(
            key=key,
            platform=str(meta["platform"]),
            account_ref=str(meta["account_ref"]),
            currency=str(ccy),
            xirr_rate=xirr(all_flows),
            terminal_value=term_value,
            flow_count=len(non_zero),
            flows=[(d, round(c, 4)) for d, c in non_zero],
        )
    return result


def simple_return_summary(conn: Any) -> dict[str, Any]:
    """Read-only aggregate: per-holding cost coverage + portfolio simple return.

    The portfolio ratio uses cost_value_base / market_value_base (INR base,
    frozen per position at write time - both sides of a position used the same
    run's fx rate, so the ratio is FX-noise-free even though XIRR deliberately
    is not: simple returns aggregate in base, XIRR never converts flows).
    """
    row = conn.execute(
        """
        SELECT COUNT(*) AS n,
               COALESCE(SUM(cost_value_base IS NULL), 0) AS no_cost,
               COALESCE(SUM(cost_value_base), 0.0) AS cost_total,
               COALESCE(SUM(market_value_base), 0.0) AS mkt_total
        FROM position
        """
    ).fetchone()
    n = int(row["n"] or 0)
    no_cost = int(row["no_cost"] or 0)
    return {
        "holdings": n,
        "with_cost": n - no_cost,
        "no_cost": no_cost,
        "portfolio_return": portfolio_simple_return(row["cost_total"], row["mkt_total"]),
    }