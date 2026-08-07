"""`portfolio` CLI entry point.

M0:  `portfolio db migrate`
M1:  `portfolio serve --platform zerodha`   (persistent session daemon + daily login)
     `portfolio snapshot --platform zerodha [--eod]`
"""

from __future__ import annotations

import logging
import sys
from contextlib import suppress
from typing import Annotated

import typer

from portfolio import __version__
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
) -> None:
    """Hold the day's authenticated broker session and serve read-only RPC."""
    if platform != "zerodha":
        raise typer.BadParameter("M1 supports only --platform zerodha")
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
) -> None:
    """Capture today's trades for XIRR (daily; same-day history only on Kite)."""
    from portfolio.snapshot import SessionNotReady
    from portfolio.trades import capture_trades

    try:
        result = capture_trades(platform)
    except SessionNotReady as exc:
        typer.echo(f"trades capture {platform}: FAILED - {exc}", err=True)
        raise typer.Exit(code=1) from exc
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
def nav_refresh() -> None:
    """Refresh CAS-derived MF + ETF prices from the official AMFI NAVAll.txt (daily, free, keyless).

    One AMFI fetch per run. Updates every CAS-derived mutual fund AND ETF position's
    price in `position` (Indian ETFs are open-ended schemes in the same feed), writes
    a price_history + position_snapshot row for today, and logs a `runs` row
    (platform='amfi'). Live-leg positions (zerodha/moomoo) are never touched; CAS
    equities have no AMFI NAV and stay at the statement price until the next import.
    """
    from portfolio.mf_nav import NAVError, refresh_nav_prices

    try:
        result = refresh_nav_prices()
    except NAVError as exc:
        typer.echo(f"nav refresh: FAILED - {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"nav refresh: {result}")


def _opend_reachable(host: str = "127.0.0.1", port: int = 11111) -> bool:
    import socket

    try:
        with socket.create_connection((host, port), timeout=3):
            return True
    except OSError:
        return False


@app.command("snapshot")
def snapshot(
    platform: Annotated[str, typer.Option(help="zerodha | moomoo | all")] = "zerodha",
    eod: Annotated[bool, typer.Option(help="mark run as end-of-day")] = False,
) -> None:
    """Run a snapshot for a platform."""
    from portfolio.snapshot import SessionNotReady, run_snapshot

    try:
        result = run_snapshot(platform, is_eod=eod)
    except SessionNotReady as exc:
        typer.echo(f"snapshot {platform}: FAILED - {exc}", err=True)
        raise typer.Exit(code=1) from exc
    except Exception as exc:  # noqa: BLE001 - belt for unexpected bugs: a clean
        # error + exit 1, never a raw traceback in a scheduled job's log.
        logger.error("snapshot %s crashed: %s", platform, exc)
        typer.echo(f"snapshot {platform}: FAILED - unexpected error: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"snapshot {platform}: {result}")


if __name__ == "__main__":
    app()
