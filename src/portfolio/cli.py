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


@app.command("snapshot")
def snapshot(
    platform: Annotated[str, typer.Option(help="zerodha | moomoo | groww | all")] = "zerodha",
    eod: Annotated[bool, typer.Option(help="mark run as end-of-day")] = False,
) -> None:
    """Run a snapshot for a platform."""
    from portfolio.snapshot import SessionNotReady, run_snapshot

    try:
        result = run_snapshot(platform, is_eod=eod)
    except SessionNotReady as exc:
        typer.echo(f"snapshot {platform}: FAILED - {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"snapshot {platform}: {result}")


if __name__ == "__main__":
    app()
