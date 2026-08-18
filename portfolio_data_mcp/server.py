"""Read-only MCP server exposing the portfolio SQLite DB to the Q&A agent (M7).

THE READ-ONLY CONTRACT
----------------------
* Every tool is SELECT-only. No write tool is EVER registered here - there is
  no `place_order`, no `update`, no `INSERT`, nothing that mutates state. The
  connection itself is opened in SQLite read-only mode (`mode=ro`), so even a
  buggy query can never write to the DB: the filesystem is the second lock.
* Tool inputs are explicit and bounded (limit N, optional exact filters). Raw
  SQL is never accepted from a caller - the SQL is written here, parameterised,
  and only the bound values come from the tool arguments.
* This server is part of the DETERMINISM BOUNDARY (AGENTS.md guardrail #4): it
  computes views over the already-written pipeline data (position,
  position_snapshot, runs, alert_events, daily_performance) and returns plain
  JSON. No LLM output flows into it and it never changes the underlying data -
  the agent reads, never writes.

Why a dedicated server instead of letting the agent hit SQLite directly? The
agent's opencode config allowlists MCP tools by name; a local MCP server is the
only way to expose a *curated, bounded, read-only* surface (7 tools) with the
SQL hidden behind named tool calls. Moomoo's wrapper (moomoo_mcp/server.py)
shows the same pattern: our own FastMCP server, read tools only.

The DB path honours PORTFOLIO_DB_PATH (same env override as the pipeline, so
tests can point it at a scratch DB). Output shapes: every tool returns a single
JSON object (dict) - MCPServer emits ONE text item per list element, so a bare
list would fragment into N texts and only the first would parse (moomoo_mcp
hits the same quirk; wrapping in a dict keeps each result ONE JSON object).
"""

from __future__ import annotations

import logging
import re
import sqlite3
from pathlib import Path
from typing import Any

from mcp.server.mcpserver.server import MCPServer

from portfolio.config import DB_PATH, PLATFORMS

logger = logging.getLogger("portfolio_data_mcp")

server = MCPServer("portfolio-data", version="0.1.0", log_level="WARNING")

# Bounds: every limit is clamped to this range before it touches SQL.
MAX_LIMIT = 500
DEFAULT_LIMIT = 100


def _connect() -> sqlite3.Connection:
    """Open the DB in SQLite READ-ONLY mode (the filesystem-level lock).

    `Path.as_uri()` yields a proper `file:///...` URI (backslashes escaped on
    Windows); appending `?mode=ro` makes SQLite refuse any write. A missing DB
    surfaces as a clean sqlite3.Error ("unable to open database file"), which
    tools convert into a structured error payload.
    """
    uri = f"{Path(DB_PATH).resolve().as_uri()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _clamp(limit: int | None, default: int = DEFAULT_LIMIT) -> int:
    """Coerce a caller-supplied limit into [1, MAX_LIMIT] (bounded inputs)."""
    try:
        value = int(limit)
    except (TypeError, ValueError):
        value = default
    return max(1, min(value, MAX_LIMIT))


def _opt_str(value: Any, *, upper: bool = False) -> str | None:
    """None for empty input; stripped string otherwise (optional filters)."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.upper() if upper else text


# The rebuild's scope vocabulary (performance.py writes exactly these).
PERF_SCOPE_TYPES = {"all", "geography", "platform", "asset_class", "currency"}
# Optional date filters are validated to YYYY-MM-DD before they touch SQL -
# a malformed string can never silently match nothing via BETWEEN.
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# The SELECT column list, shared by the tool and the SQL (never caller input).
PERF_COLUMNS = (
    "perf_date, scope_type, scope_key, value_base, day_pnl_base,"
    " broker_day_pnl_base, day_pnl_pct, simple_return_pct,"
    " cost_with, cost_without, rebuilt_at"
)


def _check_date(label: str, value: Any) -> str | None:
    """Validate an optional YYYY-MM-DD filter; None when absent (bounded input)."""
    text = _opt_str(value)
    if text is not None and _DATE_RE.match(text) is None:
        raise ValueError(f"{label} must be a YYYY-MM-DD date string, got {value!r}")
    return text


def _round2(value: float | None) -> float | None:
    """Round a (possibly NULL) REAL column to 2dp for the agent-facing envelope."""
    return None if value is None else round(value, 2)


def _perf_rows(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    scope_type: str | None = None,
    scope_key: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[dict[str, Any]]:
    """Daily performance ledger rows, filtered, date/scope-ordered."""
    where, params = ["1=1"], []
    if date_from is not None and date_to is not None:
        where.append("perf_date BETWEEN ? AND ?")
        params.extend([date_from, date_to])
    elif date_from is not None:
        where.append("perf_date >= ?")
        params.append(date_from)
    elif date_to is not None:
        where.append("perf_date <= ?")
        params.append(date_to)
    if scope_type is not None:
        where.append("scope_type = ?")
        params.append(scope_type)
    if scope_key is not None:
        where.append("LOWER(scope_key) = LOWER(?)")
        params.append(scope_key)
    params.append(_clamp(limit))
    sql = f"""
        SELECT {PERF_COLUMNS}
        FROM daily_performance
        WHERE {' AND '.join(where)}
        ORDER BY perf_date, scope_type, scope_key
        LIMIT ?
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        row = dict(r)
        for col in (
            "value_base",
            "day_pnl_base",
            "broker_day_pnl_base",
            "day_pnl_pct",
            "simple_return_pct",
        ):
            row[col] = _round2(row[col])
        out.append(row)
    return out


def _platform_ok(platform: str | None) -> str | None:
    """Validate a platform filter against the registry; None when absent."""
    if platform is None:
        return None
    name = str(platform).strip().lower()
    if name not in PLATFORMS:
        raise ValueError(f"unknown platform {platform!r}; expected one of {sorted(PLATFORMS)}")
    return name


def _error(message: str) -> dict[str, Any]:
    """A structured error payload the LLM can read and reason about."""
    return {"error": message, "count": 0}


def _holding_rows(
    *,
    platform: str | None = None,
    ticker: str | None = None,
    sector: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[dict[str, Any]]:
    """Latest live holdings (position), optionally filtered, value-descending."""
    where, params = ["1=1"], []
    if platform is not None:
        where.append("a.platform = ?")
        params.append(platform)
    if ticker is not None:
        where.append("UPPER(i.ticker) = UPPER(?)")
        params.append(ticker)
    if sector is not None:
        where.append("LOWER(i.sector) = LOWER(?)")
        params.append(sector)
    params.append(_clamp(limit))
    sql = f"""
        SELECT a.platform, i.geography, i.ticker, i.name, i.currency,
               i.sector, i.asset_class, p.quantity, p.price,
               p.market_value_base, p.updated_at
        FROM position p
        JOIN account a    ON a.id = p.account_id
        JOIN instrument i ON i.id = p.instrument_id
        WHERE {' AND '.join(where)}
        ORDER BY p.market_value_base DESC
        LIMIT ?
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


@server.tool()
def latest_snapshot(
    platform: str | None = None,
    ticker: str | None = None,
    sector: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """Current holdings from the latest snapshot (live `position` rows).

    Returns {count, holdings: [...]}, each holding with platform, geography,
    ticker, name, currency, sector, asset_class, quantity, price,
    market_value_base (value in the portfolio base currency, INR) and
    updated_at. Optional exact filters: platform (zerodha|moomoo|groww|
    sharekhan), ticker (case-insensitive), sector (case-insensitive). Sorted by
    value descending, limited to `limit` (max 500). Read-only.
    """
    try:
        rows = _holding_rows(
            platform=_platform_ok(platform),
            ticker=_opt_str(ticker, upper=True),
            sector=_opt_str(sector),
            limit=limit,
        )
    except (sqlite3.Error, ValueError) as exc:
        return _error(str(exc))
    return {"count": len(rows), "holdings": rows}


@server.tool()
def holding_returns(
    platform: str | None = None,
    ticker: str | None = None,
    sector: str | None = None,
    asset_class: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """Per-holding return vs cost basis - "which holding performed best/worst".

    returnPct = (market_value_base - cost_value_base) / cost_value_base * 100,
    the SAME formula export_json uses for the dashboard's returnPct, so the
    agent's number always matches the dashboard's. Holdings with no cost basis
    (the M3 CAS value-only rows) have returnPct = null and sort LAST - a
    costless row can never masquerade as the best performer. Returns
    {count, withCost, noCost, holdings: [...]}, each holding with platform,
    geography, ticker, name, currency, sector, asset_class, quantity, price,
    costValueBase, marketValueBase, returnPct (null when costless) and
    updated_at. Optional exact filters: platform (zerodha|moomoo|groww|
    sharekhan), ticker (case-insensitive), sector (case-insensitive),
    asset_class (case-insensitive - e.g. "best MF vs best ETF vs best stock").
    Sorted by returnPct descending (costless last), limited to `limit`
    (max 500). Read-only.
    """
    try:
        pf = _platform_ok(platform)
        tk = _opt_str(ticker, upper=True)
        se = _opt_str(sector)
        ac = _opt_str(asset_class)
    except ValueError as exc:
        return _error(str(exc))
    where, params = ["1=1"], []
    if pf is not None:
        where.append("a.platform = ?")
        params.append(pf)
    if tk is not None:
        where.append("UPPER(i.ticker) = UPPER(?)")
        params.append(tk)
    if se is not None:
        where.append("LOWER(i.sector) = LOWER(?)")
        params.append(se)
    if ac is not None:
        where.append("LOWER(i.asset_class) = LOWER(?)")
        params.append(ac)
    n = _clamp(limit)
    # The SQL LIMIT is MAX_LIMIT, NOT the caller's limit: the caller's limit
    # must apply AFTER the return sort (best first), so the match set is
    # fetched up to the module-wide cap (bounded; the DB holds ~tens of rows)
    # and sliced to `n` below. A SQL-side `LIMIT n` would truncate before
    # sorting and could silently drop the true best performer.
    params.append(MAX_LIMIT)
    sql = f"""
        SELECT a.platform, i.geography, i.ticker, i.name, i.currency,
               i.sector, i.asset_class, p.quantity, p.price,
               p.cost_value_base, p.market_value_base, p.updated_at
        FROM position p
        JOIN account a    ON a.id = p.account_id
        JOIN instrument i ON i.id = p.instrument_id
        WHERE {' AND '.join(where)}
        LIMIT ?
    """
    try:
        with _connect() as conn:
            rows = conn.execute(sql, params).fetchall()
    except sqlite3.Error as exc:
        return _error(str(exc))
    holdings: list[dict[str, Any]] = []
    for r in rows:
        ret = None
        if r["cost_value_base"]:  # truthy check == export_json semantics
            ret = round(
                (r["market_value_base"] - r["cost_value_base"])
                / r["cost_value_base"] * 100.0,
                2,
            )
        holdings.append(
            {
                "platform": r["platform"],
                "geography": r["geography"],
                "ticker": r["ticker"],
                "name": r["name"],
                "currency": r["currency"],
                "sector": r["sector"],
                "asset_class": r["asset_class"],
                "quantity": r["quantity"],
                "price": r["price"],
                "costValueBase": r["cost_value_base"],
                "marketValueBase": r["market_value_base"],
                "returnPct": ret,
                "updated_at": r["updated_at"],
            }
        )
    # Best first, costless (returnPct null) LAST: (is_none, -pct) sorts all
    # False before True, and among the cost-bearing rows puts the largest
    # return first. Never a None/float comparison (that would raise).
    holdings.sort(key=lambda h: (h["returnPct"] is None, -(h["returnPct"] or 0.0)))
    holdings = holdings[:n]
    with_cost = sum(1 for h in holdings if h["returnPct"] is not None)
    return {
        "count": len(holdings),
        "withCost": with_cost,
        "noCost": len(holdings) - with_cost,
        "holdings": holdings,
    }


@server.tool()
def allocation_summary() -> dict[str, Any]:
    """Portfolio allocation from the latest positions, in the base currency.

    Returns {totalBase, holdingsCount, byGeography, byPlatform, bySector,
    byAssetClass}; each bucket is {value, pct} where pct is that bucket's share
    of totalBase (0-100, 2dp). Useful for "what is my exposure to X" questions
    before drilling into individual holdings. Read-only.
    """
    try:
        rows = _holding_rows(limit=MAX_LIMIT)
    except sqlite3.Error as exc:
        return _error(str(exc))
    total = sum(r["market_value_base"] for r in rows) or 0.0

    def _bucket(key: str) -> dict[str, dict[str, float]]:
        out: dict[str, dict[str, float]] = {}
        for r in rows:
            label = r[key] or "unknown"
            entry = out.setdefault(label, {"value": 0.0, "pct": 0.0})
            entry["value"] += r["market_value_base"]
        for entry in out.values():
            entry["pct"] = round(entry["value"] / total * 100.0, 2) if total else 0.0
        return dict(sorted(out.items()))

    return {
        "totalBase": round(total, 2),
        "holdingsCount": len(rows),
        "byGeography": _bucket("geography"),
        "byPlatform": _bucket("platform"),
        "bySector": _bucket("sector"),
        "byAssetClass": _bucket("asset_class"),
    }


@server.tool()
def holding_history(ticker: str, limit: int = 60) -> dict[str, Any]:
    """Daily value series for one ticker from the position_snapshot ledger.

    `ticker` is required (case-insensitive). Returns {ticker, count, points:
    [...]} with the newest `limit` daily points (max 500) ordered oldest ->
    newest: each point has snapshot_date, platform, quantity, price,
    market_value_base. Use for trend questions ("how has X done over time").
    Read-only.
    """
    name = _opt_str(ticker, upper=True)
    if name is None:
        return _error("ticker is required")
    n = _clamp(limit, default=60)
    sql = """
        SELECT ps.snapshot_date, a.platform, i.ticker, ps.quantity, ps.price,
               ps.market_value_base
        FROM position_snapshot ps
        JOIN account a    ON a.id = ps.account_id
        JOIN instrument i ON i.id = ps.instrument_id
        WHERE UPPER(i.ticker) = UPPER(?)
        ORDER BY ps.snapshot_date DESC
        LIMIT ?
    """
    try:
        with _connect() as conn:
            rows = conn.execute(sql, (name, n)).fetchall()
    except sqlite3.Error as exc:
        return _error(str(exc))
    points = [dict(r) for r in rows][::-1]  # oldest first for charting
    return {"ticker": name, "count": len(points), "points": points}


@server.tool()
def portfolio_total() -> dict[str, Any]:
    """Sum of all latest holdings in the base currency (INR).

    Returns {totalBase, holdingsCount, byPlatform: {platform: value}} so a
    follow-up question can compare platforms without another tool call.
    Read-only.
    """
    try:
        rows = _holding_rows(limit=MAX_LIMIT)
    except sqlite3.Error as exc:
        return _error(str(exc))
    total = sum(r["market_value_base"] for r in rows)
    by_platform: dict[str, float] = {}
    for r in rows:
        by_platform[r["platform"]] = by_platform.get(r["platform"], 0.0) + r["market_value_base"]
    return {
        "totalBase": round(total, 2),
        "holdingsCount": len(rows),
        "byPlatform": {k: round(v, 2) for k, v in sorted(by_platform.items())},
    }


@server.tool()
def recent_runs(limit: int = 10) -> dict[str, Any]:
    """The pipeline audit trail: the last `limit` runs.

    Returns {count, runs: [...]} with id, platform, status (ok|skipped|error),
    started_at (UTC ISO), is_eod and error (message for failed/skipped runs).
    This is how the agent answers "did today's snapshot run / why did it fail".
    Read-only.
    """
    n = _clamp(limit, default=10)
    sql = """
        SELECT id, platform, status, started_at, error, is_eod
        FROM runs ORDER BY id DESC LIMIT ?
    """
    try:
        with _connect() as conn:
            rows = conn.execute(sql, (n,)).fetchall()
    except sqlite3.Error as exc:
        return _error(str(exc))
    return {"count": len(rows), "runs": [dict(r) for r in rows]}


@server.tool()
def fired_alerts(limit: int = 10, severity: str | None = None) -> dict[str, Any]:
    """Recently fired rule alerts (M6 alert_events).

    Optional `severity` filter: info | warn | critical. Returns {count,
    alerts: [...]} with rule_id, event_date (Asia/Kolkata market date),
    severity and message. Read-only.
    """
    n = _clamp(limit, default=10)
    if severity is not None:
        sev = str(severity).strip().lower()
        if sev not in {"info", "warn", "critical"}:
            return _error(f"unknown severity {severity!r}; expected info|warn|critical")
    sql = """
        SELECT rule_id, event_date, severity, message, created_at
        FROM alert_events
        {where}
        ORDER BY id DESC LIMIT ?
    """
    where, params = "", []
    if severity is not None:
        where = "WHERE severity = ?"
        params.append(sev)  # type: ignore[possibly-undefined]
    params.append(n)
    try:
        with _connect() as conn:
            rows = conn.execute(sql.format(where=where), params).fetchall()
    except sqlite3.Error as exc:
        return _error(str(exc))
    return {"count": len(rows), "alerts": [dict(r) for r in rows]}


@server.tool()
def daily_performance(
    date_from: str | None = None,
    date_to: str | None = None,
    scope_type: str | None = None,
    scope_key: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """Daily performance per date/scope: value, day P&L, returns.

    Reads the REBUILT performance ledger (`daily_performance`, written by the
    M8.6 table rebuild at export time) - one row per (perf_date, scope_type,
    scope_key). Each row carries value_base (portfolio value in the base
    currency, INR), day_pnl_base (that day's interval-rule daily move),
    broker_day_pnl_base (broker-reported day P&L when the scope has one, else
    null), day_pnl_pct, simple_return_pct and the cost-basis coverage counts
    cost_with / cost_without. This answers "what drove the drop last week" by
    comparing scopes across dates. Optional exact filters: date_from / date_to
    (YYYY-MM-DD, inclusive; a malformed date is a structured error), scope_type
    (all|geography|platform|asset_class|currency - anything else is a
    structured error), scope_key (case-insensitive; e.g. IN|US, zerodha,
    equity). Ordered by (perf_date, scope_type, scope_key), limited to `limit`
    (max 500). Returns {rows: [...], count, note}; note is null normally and
    set only when the ledger table is not available yet (migration not applied)
    - an empty, graceful result, never a crash. Read-only.
    """
    try:
        d_from = _check_date("date_from", date_from)
        d_to = _check_date("date_to", date_to)
        scope = _opt_str(scope_type)
        if scope is not None:
            scope = scope.lower()
            if scope not in PERF_SCOPE_TYPES:
                return _error(
                    f"unknown scope_type {scope_type!r}; expected one of "
                    f"{sorted(PERF_SCOPE_TYPES)}"
                )
        key = _opt_str(scope_key)
    except ValueError as exc:
        return _error(str(exc))
    try:
        rows = _perf_rows(
            date_from=d_from,
            date_to=d_to,
            scope_type=scope,
            scope_key=key,
            limit=limit,
        )
    except sqlite3.OperationalError as exc:
        # Graceful degradation: a fresh DB before migration 0010 runs has no
        # daily_performance table. Return the documented empty envelope with a
        # note the agent can repeat - never a crash, never a raw error string.
        if "no such table" in str(exc):
            return {
                "rows": [],
                "count": 0,
                "note": "daily_performance table not available yet (migration 0010)",
            }
        return _error(str(exc))
    except sqlite3.Error as exc:
        return _error(str(exc))
    return {"rows": rows, "count": len(rows), "note": None}


def main() -> None:
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
