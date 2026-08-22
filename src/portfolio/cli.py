"""`portfolio` CLI entry point.

M0:  `portfolio db migrate`
M1:  `portfolio serve --platform zerodha`   (persistent session daemon + daily login)
     `portfolio snapshot --platform zerodha [--eod]`
"""

from __future__ import annotations

import logging
import re
import sys
from contextlib import suppress
from datetime import UTC, datetime
from typing import Annotated

import typer

from portfolio import __version__
from portfolio.agent.client import DEFAULT_BASE_URL
from portfolio.db.migrate import migrate
from portfolio.logging import setup_logging

app = typer.Typer(
    name="portfolio",
    help="Agentic portfolio dashboard pipeline (deterministic M0-M6).",
    no_args_is_help=True,
)
db_app = typer.Typer(help="Database commands.")
app.add_typer(db_app, name="db")
cas_app = typer.Typer(help="CAS (Consolidated Account Statement) import - Groww/IN holdings.")
app.add_typer(cas_app, name="cas")
nav_app = typer.Typer(help="AMFI NAV commands (daily MF price refresh).")
app.add_typer(nav_app, name="nav")
fx_app = typer.Typer(help="Foreign exchange commands (daily rate table, keyless).")
app.add_typer(fx_app, name="fx")
prop_app = typer.Typer(help="Real estate property import (manual valuation entry).")
app.add_typer(prop_app, name="property")
goal_app = typer.Typer(help="Savings goals (dashboard journey goals, M8.9).")
app.add_typer(goal_app, name="goal")

logger = logging.getLogger("portfolio.cli")


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"portfolio {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[bool | None, typer.Option("--version", callback=_version_callback)] = None,
) -> None:
    """Common CLI setup: logging + redaction filter + console-safe stdout."""
    # Windows consoles use cp1252 and crash on emoji/foreign chars in prints
    # (e.g. Zerodha's login warning contains "⚠️"). Never let that kill a run.
    for stream in (sys.stdout, sys.stderr):
        with suppress(AttributeError, ValueError):  # not a TextIOWrapper->leave as-is
            stream.reconfigure(errors="replace")
    setup_logging()
    logger.debug("cli start")


@db_app.command("migrate")
def db_migrate() -> None:
    """Create/upgrade the SQLite schema (idempotent)."""
    version = migrate()
    typer.echo(f"schema at v{version}")


@app.command("serve")
def serve(
    platform: Annotated[str, typer.Option(help="zerodha (only platform in M1)")] = "zerodha",
    port: Annotated[int, typer.Option(help="loopback RPC port")] = 8787,
    gate: Annotated[bool, typer.Option(
        help="exit 0 quietly when today is not an IN trading day (scheduled daemon start)"
    )] = False,
) -> None:
    """Hold the day's authenticated broker session and serve read-only RPC.

    With `--gate` (OPT-IN, for the scheduled 09:35 start): the daemon only
    starts on an IN trading day. On a weekend/holiday it prints `skipped
    (<reason>)` and exits 0 WITHOUT launching the daemon or prompting the
    daily manual 2FA login for a session nothing will use (guardrail #3 -
    the login is manual; we simply avoid triggering it on closed days). The
    policy is trading-day (is_eod=True): the daemon serves both the 09:45
    live and the 15:45 EOD runs, so any trading day qualifies, at any time.

    Default (no --gate) is unchanged: manual `portfolio serve` and
    snapshot.py's daemon auto-spawn stay ungated, so a --force holiday
    snapshot can still spawn the daemon.
    """
    if platform != "zerodha":
        raise typer.BadParameter("M1 supports only --platform zerodha")
    if gate:
        from portfolio.calendars import gate_check

        reason = gate_check("IN", _now_utc(), is_eod=True)
        if reason:
            typer.echo(f"skipped ({reason})")
            return
    from portfolio import serve as serve_mod

    typer.echo(f"starting {platform} session daemon on 127.0.0.1:{port} ...")
    serve_mod.run(port=port)


@app.command("auth")
def auth(
    platform: Annotated[str, typer.Option(help="moomoo (OpenD gateway setup)")] = "moomoo",
) -> None:
    """Set up the Moomoo leg: verify OpenD, store the trade password, test read.

    Moomoo account data comes from the OpenD gateway (the desktop app holds the
    login - see PLAN.md M2 spike findings). This command:
      1. checks OpenD is reachable on 127.0.0.1:11111,
      2. prompts for the trade password (unlock_trade) and stores it in the
         gitignored token store,
      3. runs one read-only end-to-end check (accounts + holdings count).
    """
    if platform != "moomoo":
        raise typer.BadParameter("auth supports only --platform moomoo")

    import asyncio

    from portfolio.tokens import store

    if not _opend_reachable():
        typer.echo(
            "ERROR: OpenD is not running on 127.0.0.1:11111.\n"
            "Install it from https://www.moomoo.com/download/opend, open the app,\n"
            "and log in with your Moomoo account, then re-run this command.",
            err=True,
        )
        raise typer.Exit(code=1)

    existing = store.platform_store("moomoo").get("trade_password")
    typer.echo(f"OpenD reachable on 127.0.0.1:11111. Trade password: {'already stored' if existing else 'not set'}.")
    password = typer.prompt("Moomoo trade password", hide_input=True, confirmation_prompt=False)
    if not password:
        typer.echo("no password given - keeping the existing configuration.", err=True)
        raise typer.Exit(code=1)
    store.set_platform_value("moomoo", "trade_password", password)

    from portfolio.clients.moomoo import MoomooMCPClient
    from portfolio.normalize.moomoo import normalize_holdings
    from portfolio.snapshot import _pick_real_account

    async def _check() -> str:
        async with MoomooMCPClient() as client:
            acc_res = await client.call("get_accounts")
            if acc_res.is_error:
                return f"FAILED: {acc_res.raw[:200]}"
            acc_id = _pick_real_account(acc_res.json())
            if acc_id is None:
                return "FAILED: no REAL account in get_accounts"
            pos_res = await client.call("get_positions", {"trd_env": "REAL", "acc_id": acc_id})
            if pos_res.is_error:
                return f"FAILED: {pos_res.raw[:200]}"
            holdings = normalize_holdings(pos_res.json() or [])
            return f"ok - REAL account {acc_id}: {len(holdings)} holdings readable"

    typer.echo(asyncio.run(_check()))


@app.command("trades")
def trades(
    platform: Annotated[str, typer.Option(help="zerodha | moomoo | all")] = "all",
    force: Annotated[bool, typer.Option(help="bypass the market-hours/holiday gate")] = False,
) -> None:
    """Capture today's trades for XIRR (daily; same-day history only on Kite).

    Calendar-gated as an EOD-style task (is_eod=True: trading-day check only):
    an all-closed market writes an audited `skipped` runs row and exits 0 - a
    holiday is not a failure. `--platform all` runs when ANY market is a
    trading day; closed legs are skipped per-leg inside the capture path and
    never touch their broker (MAJOR-2).

    Run audit (MAJOR-1, mirrors nav refresh): once the gate passes, one
    platform='trades' row per attempt - 'running' before capture, 'ok' with
    rows=<new trades captured> on success, 'error' on failure + exit 1 - so a
    capture failure is VISIBLE in `runs`, never a silent exit 0.
    """
    from portfolio.snapshot import SessionNotReady
    from portfolio.trades import capture_trades

    at = _now_utc()
    if not force:
        reason = _trades_skip_reason(at, platform)
        if reason:
            _write_skipped_run("trades", reason, at, is_eod=True)
            typer.echo(f"trades capture {platform}: skipped ({reason})")
            return
    # Gate passed (or --force): the run gets a full audit lifecycle. The DB
    # path is resolved once so the runs row and the capture write the SAME db.
    db_path = _db_path()
    run_id = _write_running_run("trades", at, db_path, is_eod=True)
    try:
        result = capture_trades(platform, db_path=db_path, at=at)
    except SessionNotReady as exc:
        _update_run_row(run_id, "error", 0, str(exc), db_path)
        typer.echo(f"trades capture {platform}: FAILED - {exc}", err=True)
        raise typer.Exit(code=1) from exc
    except Exception as exc:  # noqa: BLE001 - belt for unexpected bugs (e.g.
        # trades.SessionNotReady is a SEPARATE class from snapshot's - the
        # except above can miss it): any capture failure must still land an
        # audited error row and exit 1, never a raw traceback in a scheduled
        # job's log.
        _update_run_row(run_id, "error", 0, str(exc), db_path)
        logger.error("trades capture %s crashed: %s", platform, exc)
        typer.echo(f"trades capture {platform}: FAILED - unexpected error: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    _update_run_row(run_id, "ok", _new_trades_count(result), None, db_path)
    typer.echo(f"trades capture {platform}: {result}")


@cas_app.command("import")
def cas_import(
    pdf: Annotated[str, typer.Argument(help="path to the CAS PDF (the original issuer file)")],
    password: Annotated[str, typer.Option(help="CAS PDF password, if encrypted")] = "",
    no_enrich: Annotated[bool, typer.Option("--no-enrich", help="skip AMFI scheme-name enrichment")] = False,
) -> None:
    """Parse a CAS PDF and persist holdings (stocks + MFs) to the DB.

    Free, SEBI-mandated, emailed monthly. Covers CDSL/NSDL demat + CAMS/KFintech
    folios. Folio MFs carry cost basis (returns computable); demat MFs and
    equities are value-only until a cost source exists. Zerodha equities are
    skipped (already captured live via MCP).
    """
    from portfolio.cas_import import import_cas

    result = import_cas(pdf, password=password, enrich_names=not no_enrich)
    typer.echo(f"cas import: {result}")


@nav_app.command("refresh")
def nav_refresh(
    force: Annotated[bool, typer.Option(help="bypass the market-hours/holiday gate")] = False,
) -> None:
    """Refresh CAS-derived MF + ETF prices from the official AMFI NAVAll.txt (daily, free, keyless).

    One AMFI fetch per run. Updates every CAS-derived mutual fund AND ETF position's
    price in `position` (Indian ETFs are open-ended schemes in the same feed), writes
    a price_history + position_snapshot row for today, and logs a `runs` row
    (platform='amfi'). Live-leg positions (zerodha/moomoo) are never touched; CAS
    equities have no AMFI NAV and stay at the statement price until the next import.

    Calendar-gated on the IN trading-day policy (is_eod=True): on a holiday or
    weekend the command writes an audited platform='amfi' `skipped` runs row
    and exits 0 WITHOUT touching the AMFI feed - a holiday is not a failure.
    """
    from portfolio.calendars import gate_check
    from portfolio.mf_nav import NAVError, refresh_nav_prices

    at = _now_utc()
    if not force:
        reason = gate_check("IN", at, is_eod=True)
        if reason:
            _write_skipped_run("amfi", reason, at, is_eod=True)
            typer.echo(f"nav refresh: skipped ({reason})")
            return
    try:
        result = refresh_nav_prices()
    except NAVError as exc:
        typer.echo(f"nav refresh: FAILED - {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"nav refresh: {result}")


@fx_app.command("refresh")
def fx_refresh() -> None:
    """Fetch ONE rate table per run and persist it to fx_rates (M4 21:30 leg).

    Ungated by design: FX is a global market - the 21:30 IST slot is mid-session
    in the US, so there is no exchange calendar to consult. rate_date is the
    Asia/Kolkata date; UNIQUE(rate_date, base, quote, source) makes a same-day
    re-run a no-op (idempotent).

    Run audit (MAJOR-3): one platform='fx' row per attempt - 'running' before
    the fetch, 'ok' with rows=<quotes persisted> on success, 'error' + exit 1
    on FXError - so the keyless leg is visible to the runs audit (the M9
    staleness monitor reads runs).
    """
    from zoneinfo import ZoneInfo

    from portfolio.config import Settings
    from portfolio.db import connect, writer
    from portfolio.fx import FXError, get_fx_rates

    base = Settings().base_currency
    quotes = ["USD", "SGD"]
    at = _now_utc()
    rate_date = at.astimezone(ZoneInfo("Asia/Kolkata")).date().isoformat()
    db_path = _db_path()
    conn = connect(db_path)
    try:
        run_id = writer.write_run(
            conn, "fx", rate_date, datetime.now(UTC).isoformat(), "running", is_eod=True,
        )
        try:
            rates = get_fx_rates(base, quotes)
        except FXError as exc:
            writer.update_run(conn, run_id, "error", 0, error=str(exc))
            typer.echo(f"fx refresh: FAILED - {exc}", err=True)
            raise typer.Exit(code=1) from exc
        for quote in quotes:
            writer.ensure_fx_rate(
                conn, rate_date, base, quote, Settings().fx_source,
                rates[quote], at.isoformat(),
            )
        writer.update_run(conn, run_id, "ok", len(quotes))
    finally:
        conn.close()
    summary = " ".join(f"{q}{base}={_fmt_rate(rates[q])}" for q in quotes)
    typer.echo(f"fx refresh: {summary}")


@prop_app.command("import")
def prop_import(
    json_file: Annotated[str, typer.Argument(help="path to the property JSON file")],
    valuation_date: Annotated[str | None, typer.Option("--valuation-date", help="override valuation date (YYYY-MM-DD)")] = None,
) -> None:
    """Import a property valuation JSON and persist to the DB.

    The JSON format (manual entry, gitignored data/properties/):
    {
      "property_id": "PROP_BLR_001",
      "address": "123 Whitefield, Bangalore",
      "property_type": "residential",
      "purchase_date": "2020-03-15",
      "purchase_price": 8500000,
      "current_valuation": 12000000,
      "improvements": [
        { "date": "2021-06-01", "amount": 500000, "description": "Kitchen renovation" }
      ]
    }

    Creates a holding (asset_class="real_estate") + trade rows for XIRR:
    - Purchase (outflow) on purchase_date
    - Each improvement (outflow) on its date
    - Terminal (as-if-sold inflow) on valuation_date (today by default)

    Re-running with the same JSON is idempotent (dedupe via external_id).
    """
    from portfolio.property_import import import_property

    result = import_property(json_file, valuation_date=valuation_date)
    typer.echo(f"property import: {result}")


@goal_app.command("add")
def goal_add(
    label: Annotated[str, typer.Option("--label", help="goal name, e.g. 'Emergency fund'")],
    target: Annotated[float, typer.Option("--target", help="target amount (> 0)")],
    color: Annotated[str | None, typer.Option("--color", help="hex color, e.g. '#22c55e'")] = None,
) -> None:
    """Add a savings goal (targets only - progress is derived at read time)."""
    from portfolio.goals import add_goal

    try:
        goal = add_goal(label, target, color=color)
    except ValueError as exc:
        typer.echo(f"goal add: FAILED - {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(
        f"goal added: #{goal['id']} {goal['label']}"
        f" target={goal['target_amount']:,.2f} color={goal['color']}"
    )


@goal_app.command("list")
def goal_list() -> None:
    """List savings goals (creation order, one line each)."""
    from portfolio.goals import list_goals

    goals = list_goals()
    if not goals:
        typer.echo('no goals yet - add one: portfolio goal add --label "..." --target N')
        return
    for g in goals:
        crossed = f" crossed_at={g['crossed_at']}" if g["crossed_at"] else ""
        typer.echo(
            f"#{g['id']}  {g['label']}  target={g['target_amount']:,.2f}"
            f"  color={g['color']}{crossed}"
        )


@goal_app.command("update")
def goal_update(
    goal_id: Annotated[int, typer.Argument(help="goal id (see: portfolio goal list)")],
    label: Annotated[str | None, typer.Option("--label", help="new label")] = None,
    target: Annotated[float | None, typer.Option("--target", help="new target amount (> 0)")] = None,
    color: Annotated[str | None, typer.Option("--color", help="new hex color")] = None,
) -> None:
    """Update a goal (partial - only the given fields change)."""
    from portfolio.goals import update_goal

    try:
        goal = update_goal(goal_id, label=label, target_amount=target, color=color)
    except ValueError as exc:
        typer.echo(f"goal update: FAILED - {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(
        f"goal updated: #{goal['id']} {goal['label']}"
        f" target={goal['target_amount']:,.2f} color={goal['color']}"
    )


@goal_app.command("delete")
def goal_delete(
    goal_id: Annotated[int, typer.Argument(help="goal id (see: portfolio goal list)")],
) -> None:
    """Delete a savings goal."""
    from portfolio.goals import delete_goal

    if delete_goal(goal_id):
        typer.echo(f"goal deleted: #{goal_id}")
    else:
        typer.echo(f"goal delete: FAILED - goal #{goal_id} not found", err=True)
        raise typer.Exit(code=1)


def _opend_reachable(host: str = "127.0.0.1", port: int = 11111) -> bool:
    import socket

    try:
        with socket.create_connection((host, port), timeout=3):
            return True
    except OSError:
        return False


# ---- M4 calendar-gate helpers -------------------------------------------------
#
# The gate policy lives in portfolio.calendars (pure). These helpers wire it
# into the CLI: a closed market writes an audited `skipped` runs row and exits
# 0 - a holiday is a normal no-op for a scheduled job, not a failure.


def _now_utc() -> datetime:
    """The wall clock for gate decisions (one place, injectable in tests).

    The CLI is the caller of the gate: it is allowed to read the clock; the
    gate itself (portfolio.calendars) never does.
    """
    return datetime.now(UTC)


def _db_path() -> str:
    """The runs/fx DB path, honoring the PORTFOLIO_DB_PATH env override
    config.py reads (tests point it at a tmp db without touching the real
    one). Commands resolve it ONCE and use it for both audit rows and the
    capture/persist calls so the two can never diverge.
    """
    import os

    from portfolio.config import DB_PATH

    return os.getenv("PORTFOLIO_DB_PATH", str(DB_PATH))


def _write_skipped_run(platform: str, reason: str, at: datetime, *, is_eod: bool) -> None:
    """Audited gate skip: one `runs` row, no broker/feed touched, exit stays 0.

    The row is what makes the skip VISIBLE in the runs audit (M4 bar). Writes
    through the canonical writer.write_skipped (MINOR-5): snapshot_date is the
    market date of the evaluated instant (`at`), started_at the real now.
    """
    from zoneinfo import ZoneInfo

    from portfolio.db import connect, writer

    snapshot_date = at.astimezone(ZoneInfo("Asia/Kolkata")).date().isoformat()
    conn = connect(_db_path())
    try:
        writer.write_skipped(
            conn, platform, snapshot_date, datetime.now(UTC).isoformat(),
            reason, is_eod=is_eod,
        )
    finally:
        conn.close()


def _write_running_run(platform: str, at: datetime, db_path: str, *, is_eod: bool) -> int:
    """Start a run's audit lifecycle: one 'running' row the caller flips to
    ok/error via _update_run_row (mirrors the nav-refresh contract, MAJOR-1)."""
    from zoneinfo import ZoneInfo

    from portfolio.db import connect, writer

    snapshot_date = at.astimezone(ZoneInfo("Asia/Kolkata")).date().isoformat()
    conn = connect(db_path)
    try:
        return writer.write_run(
            conn, platform, snapshot_date, datetime.now(UTC).isoformat(),
            "running", is_eod=is_eod,
        )
    finally:
        conn.close()


def _update_run_row(run_id: int, status: str, rows: int, error: str | None, db_path: str) -> None:
    """Flip a run row to its final status (each write commits immediately, so a
    fresh connection by run id is safe)."""
    from portfolio.db import connect, writer

    conn = connect(db_path)
    try:
        writer.update_run(conn, run_id, status, rows, error=error)
    finally:
        conn.close()


# "N new trades (M seen)" -> N; a combined `--all` summary carries one count
# per leg, so the totals SUM (rows is best-effort audit metadata: unparseable
# -> 0).
_NEW_TRADES_RE = re.compile(r"(\d+)\s+new trades")


def _new_trades_count(result: str) -> int:
    return sum(int(m) for m in _NEW_TRADES_RE.findall(result or ""))


def _trades_skip_reason(at: datetime, platform: str) -> str | None:
    """Trade-capture gate: None when at least one market can run, else the
    combined reason (an all-closed `--all` skips with ONE platform='trades'
    row).

    Trade capture is an EOD-style daily task, so the gate uses the is_eod=True
    policy (trading-day check only, any time of day); dedupe on
    UNIQUE(account_id, external_id) makes re-capture harmless.
    """
    from portfolio.calendars import gate_check
    from portfolio.config import platform_geography

    if platform == "all":
        reasons = []
        for leg in ("zerodha", "moomoo"):
            reason = gate_check(platform_geography(leg), at, is_eod=True)
            if reason:
                reasons.append(f"{leg}: {reason}")
        return "; ".join(reasons) if len(reasons) == 2 else None
    return gate_check(platform_geography(platform), at, is_eod=True)


def _fmt_rate(value: float) -> str:
    """2-decimal display - the summary's contract (USDINR=88.12 SGDINR=67.90)."""
    return f"{value:.2f}"


@app.command("snapshot")
def snapshot(
    platform: Annotated[str, typer.Option(help="zerodha | moomoo | all")] = "zerodha",
    eod: Annotated[bool, typer.Option(help="mark run as end-of-day")] = False,
    force: Annotated[bool, typer.Option(help="bypass the market-hours/holiday gate")] = False,
) -> None:
    """Run a snapshot for a platform (calendar-gated unless --force).

    A closed market (weekend/holiday/outside hours) is skipped with an audited
    `runs` row and exit 0, never a failure; --force bypasses the gate.
    """
    from portfolio.snapshot import SessionNotReady, run_snapshot

    try:
        result = run_snapshot(platform, is_eod=eod, force=force)
    except SessionNotReady as exc:
        typer.echo(f"snapshot {platform}: FAILED - {exc}", err=True)
        raise typer.Exit(code=1) from exc
    except Exception as exc:  # noqa: BLE001 - belt for unexpected bugs: a clean
        # error + exit 1, never a raw traceback in a scheduled job's log.
        logger.error("snapshot %s crashed: %s", platform, exc)
        typer.echo(f"snapshot {platform}: FAILED - unexpected error: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"snapshot {platform}: {result}")


@app.command("live")
def live(
    platform: Annotated[str, typer.Option(help="zerodha | moomoo | all")] = "all",
    timeout: Annotated[int, typer.Option(help="total timeout in seconds")] = 30,
) -> None:
    """Fast live poll - updates `position` in place, NO snapshot/history/fx/runs writes.

    Ephemeral poll for dashboards/refresh: calls Zerodha daemon RPC + Moomoo OpenD
    wrapper, upserts to `position` table only (is_eod=False, live_poll=True),
    returns fresh holdings JSON to stdout. No calendar gate, no audit trail.

    Output: {"holdings": [...], "asOf": "...", "platforms": {"zerodha": {...}, "moomoo": {...}}}
    """
    import json
    import signal
    import sys

    from portfolio.config import DB_PATH
    from portfolio.logging import setup_logging
    from portfolio.snapshot import SessionNotReady, _live_poll

    # Redirect logs to stderr so JSON on stdout stays clean
    setup_logging(stream=sys.stderr)

    # Timeout handler
    def _timeout_handler(signum, frame):
        raise TimeoutError(f"live poll exceeded {timeout}s")

    # Set alarm for timeout (Unix) - on Windows we rely on the HTTP timeouts
    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, _timeout_handler)
        signal.alarm(timeout)

    try:
        result = _live_poll(platform, db_path=DB_PATH)
    except SessionNotReady as exc:
        typer.echo(f"live {platform}: FAILED - {exc}", err=True)
        raise typer.Exit(code=1) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("live %s crashed: %s", platform, exc)
        typer.echo(f"live {platform}: FAILED - unexpected error: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    finally:
        if hasattr(signal, "SIGALRM"):
            signal.alarm(0)

    typer.echo(json.dumps(result, separators=(",", ":")))


@app.command("returns")
def returns() -> None:
    """Print M5 returns diagnostics - per-account XIRR + simple-return coverage.

    READ-ONLY compute (a verification tool, not a scheduled job): no gate, no
    runs row - the schedule does not need it. XIRR is per (account, FLOW
    currency) - zerodha INR, moomoo USD; flows are never converted (no
    complete historical FX for backfilled trades). An account with no captured
    trades yet prints "—" (flows genuinely missing), never an error.
    """
    from portfolio.db import connect
    from portfolio.returns import account_xirrs, simple_return_summary

    db_path = _db_path()
    conn = connect(db_path)
    try:
        today = datetime.now(UTC).date().isoformat()
        per_account = account_xirrs(conn, today=today)
        if per_account:
            for key, acc in sorted(per_account.items()):
                rate = f"{acc.xirr_rate * 100:.2f}%" if acc.xirr_rate is not None else "—"
                typer.echo(
                    f"xirr {key} [{acc.currency}]: {rate}"
                    f" (flows={acc.flow_count}, terminal={acc.terminal_value:,.2f})"
                )
        else:
            typer.echo("xirr: no captured trades yet - every account's flows are genuinely missing")
        summary = simple_return_summary(conn)
        if summary["portfolio_return"] is not None:
            port = f"{summary['portfolio_return'] * 100:.2f}%"
        else:
            port = "—"
        typer.echo(
            f"simple return: portfolio={port} ({summary['holdings']} holdings: "
            f"{summary['with_cost']} with / {summary['no_cost']} without cost basis)"
        )
    finally:
        conn.close()


@app.command("alerts")
def alerts(
    dry_run: Annotated[bool, typer.Option(
        "--dry-run", help="evaluate and print would-be alerts; send nothing, write nothing"
    )] = False,
) -> None:
    """Evaluate M6 alert rules against the latest data.

    Default: evaluate + dedupe (ONE Telegram message per (rule, day) - the
    alert_events UNIQUE(rule_id, event_date) key) + write
    dashboard/public/data/alerts.json (the same path the export writes). This
    is the standalone entry point for a Task Scheduler wrapper later.

    --dry-run is the VERIFICATION tool: prints would-be alerts against the
    real DB, sends nothing, writes nothing. No gate (this is an evaluation
    tool, not a broker-touching job); the injected clock is `_now_utc()`. The
    dedupe day is the Asia/Kolkata market date (kolkata_date), never UTC.
    """
    from portfolio.db import connect
    from portfolio.db.migrate import migrate

    db_path = _db_path()
    migrate(db_path)  # alert_events (0006) - idempotent, fresh-DB safety
    conn = connect(db_path)
    try:
        from portfolio.alerts.engine import (
            ALERTS_OUT,
            dedupe_and_send,
            evaluate,
            kolkata_date,
            load_rules,
            write_alerts_json,
        )

        now = _now_utc()
        today = kolkata_date(now)
        rules = load_rules()
        fired = evaluate(conn, rules, today=today, now_utc=now)
        if dry_run:
            if fired:
                for alert in fired:
                    typer.echo(f"would fire: [{alert['severity']}] {alert['message']}")
            else:
                typer.echo(f"dry-run: {len(rules)} rules evaluated, none fired")
            return
        new_events = dedupe_and_send(conn, fired, today=today, now_utc=now)
        write_alerts_json(fired, now_utc=now, path=ALERTS_OUT)
        typer.echo(
            f"alerts: {len(fired)} fired, {len(new_events)} new sent"
            f" (alerts.json -> {ALERTS_OUT})"
        )
    finally:
        conn.close()


@app.command("ask")
def ask(
    question: Annotated[str, typer.Argument(help="the question for the portfolio Q&A agent")],
    max_turns: Annotated[int, typer.Option(
        "--max-turns", help="max agentic turns (tool calls) before abort"
    )] = 12,
    timeout: Annotated[float, typer.Option(
        "--timeout", help="wall-clock budget in seconds before abort"
    )] = 180.0,
    agent_name: Annotated[str, typer.Option(
        "--agent", help="which configured agent should answer"
    )] = "portfolio-analyst",
    base_url: Annotated[str, typer.Option(
        "--base-url", help="opencode serve base URL (start it with `opencode serve`)"
    )] = DEFAULT_BASE_URL,
    no_audit: Annotated[bool, typer.Option(
        "--no-audit", help="skip the JSONL tool-call audit log (default writes it)"
    )] = False,
) -> None:
    """Ask the read-only portfolio analyst (M7) - one question, one answer.

    Talks to a RUNNING `opencode serve` instance (start it first in another
    window; the M7 eval starts its own). The agent is `portfolio-analyst`:
    MCP tools are allowlisted per-agent and every destructive tool is denied
    globally, so this command can never place an order.

    Budget (enforced CLIENT-side, the plan's design): `max_turns` counts tool
    calls and `timeout` is the wall-clock budget; breaching either fires
    POST /session/:id/abort and the partial answer is returned flagged
    aborted/timed_out. Every tool call is appended to
    data/logs/agent_audit.jsonl (gitignored) - tool name + redacted args - the
    audit trail the M7 eval replays. Answers are READ-ONLY views over the
    pipeline DB; nothing here writes to the portfolio database.
    """
    import asyncio

    from portfolio.agent.client import DEFAULT_AUDIT_PATH, AgentResult, OpenCodeClient

    async def _run() -> AgentResult | None:
        client = OpenCodeClient(
            base_url=base_url,
            audit_path=None if no_audit else DEFAULT_AUDIT_PATH,
        )
        if not await client.health():
            typer.echo(
                f"ERROR: no opencode server at {base_url} - start one with `opencode serve`",
                err=True,
            )
            return None
        return await client.ask(
            question, agent=agent_name, max_turns=max_turns, timeout_s=timeout
        )

    result = asyncio.run(_run())
    if result is None:
        raise typer.Exit(code=1)
    if result.timed_out:
        status = "TIMEOUT"
    elif result.aborted:
        status = "ABORTED (max-turns)"
    elif result.error:
        status = f"ERROR ({result.error[:120]})"
    else:
        status = "ok"
    typer.echo(result.answer or "(no answer)")
    call_summary = ", ".join(f"{c.tool}" for c in result.tool_calls) or "none"
    typer.echo(
        f"[ask] {status} | turns={result.turns} calls=[{call_summary}]"
        f" elapsed={result.elapsed_s}s within_budget={result.within_budget}"
    )
    if not no_audit:
        typer.echo(f"[ask] audit log -> {DEFAULT_AUDIT_PATH}")


if __name__ == "__main__":
    app()
