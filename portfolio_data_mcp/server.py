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
  position_snapshot, runs, alert_events) and returns plain JSON. No LLM output
  flows into it and it never changes the underlying data - the agent reads,
  never writes.

Why a dedicated server instead of letting the agent hit SQLite directly? The
agent's opencode config allowlists MCP tools by name; a local MCP server is the
only way to expose a *curated, bounded, read-only* surface (6 tools) with the
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


def main() -> None:
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
