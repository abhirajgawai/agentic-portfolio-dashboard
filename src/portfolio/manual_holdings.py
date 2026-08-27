"""Manual equity holdings — one hand-entered TOTAL value per platform.

Neither Groww nor Sharekhan exposes an API/MCP we can pull from, and there is
no per-share source to itemize against (no ticker/quantity/price feed for
either). So this leg is intentionally a single lump-sum "current value"
per platform, updated by hand whenever you check the broker app - not a
per-ticker holdings list. Value only (no cost basis, same convention as
CAS-sourced equities): current value is trustworthy, average cost is not
tracked.

Writes through the SAME shared pipeline every other leg uses:
  {platform, value} -> Holding (common schema, one synthetic instrument
  per platform) -> db.persist.persist()
  -> position (live) + position_snapshot (daily ledger) + price_history

`account_ref="manual"` + a fixed ticker (MANUAL_TOTAL) keeps this in its own
dedicated account/instrument per platform, distinct from the automated Groww
CAMS+KFintech folio import (`account_ref="folio"`) and any historical CAS
demat import (`account_ref=<client_id>`) - this leg can never collide with
or be overwritten by the automated MF pipeline, and vice versa.

Downstream consequences that fall out of this on their own (verified, not
special-cased): no cost basis -> returnPct is null -> excluded from the
Returns screen's return bars and simple-return card; no trade rows are ever
written for this account -> it can never appear in XIRR (account_xirrs()
only iterates accounts with captured trades); a >7-day gap between updates
is bucketed as a `cas_import`-kind revaluation event by
portfolio.performance, not real day P&L (the existing per-platform gap rule
already covers groww/sharekhan).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from portfolio.config import DB_PATH
from portfolio.db import connect, writer
from portfolio.normalize.schema import Holding, to_float

logger = logging.getLogger("portfolio.manual_holdings")

ACCOUNT_REF = "manual"
TICKER = "MANUAL_TOTAL"
ALLOWED_PLATFORMS = frozenset({"groww", "sharekhan"})
_DISPLAY_NAME = {
    "groww": "Groww Equities (Manual)",
    "sharekhan": "Sharekhan Equities (Manual)",
}


def _validate_platform(platform: str) -> str:
    platform = (platform or "").strip().lower()
    if platform not in ALLOWED_PLATFORMS:
        raise ValueError(f"platform must be one of {sorted(ALLOWED_PLATFORMS)}, got {platform!r}")
    return platform


def set_value(
    platform: str,
    value: float,
    *,
    db_path: str | Path = DB_PATH,
    as_of_date: str | None = None,
) -> str:
    """Set (create or overwrite) the current total equity value for a platform.

    Single unit at that value (quantity=1, price=value) - there is nothing to
    itemize, so the "price" is the whole portfolio leg. value must be > 0; use
    clear_value() to remove the leg entirely (e.g. fully exited a broker).
    """
    from portfolio.db.migrate import migrate
    from portfolio.db.persist import persist

    migrate(db_path)  # idempotent - must work on a fresh DB
    platform = _validate_platform(platform)
    amount = to_float(value)
    if amount is None or amount <= 0:
        raise ValueError(f"value must be a positive number, got {value!r}")

    if as_of_date is None:
        as_of_date = datetime.now(UTC).astimezone().date().isoformat()

    holding = Holding(
        platform=platform,
        geography="IN",
        ticker=TICKER,
        name=_DISPLAY_NAME[platform],
        quantity=1.0,
        avg_price=None,
        current_price=amount,
        cost_basis=None,
        current_value=amount,
        currency="INR",
        sector=None,
        asset_class="equity",
    )

    db = connect(db_path)
    try:
        # Microsecond precision (unlike property_import's stripped-second
        # convention): runs.UNIQUE(platform, started_at) collides on a
        # same-second double-submit (e.g. a double-clicked Save button) for
        # the SAME platform - a real risk here since a human can plausibly
        # fire two requests within one second, unlike the scheduled jobs
        # elsewhere in this codebase.
        run_at = datetime.now(UTC).isoformat()
        run_id = writer.write_run(db, platform, as_of_date, run_at, "running", is_eod=True)
        try:
            persist(db, run_id, run_at, [holding], as_of_date, "INR", is_eod=True, account_ref=ACCOUNT_REF)
        except Exception as exc:  # noqa: BLE001 - audit the failure, keep going
            writer.update_run(db, run_id, "error", 0, error=str(exc))
            logger.error("manual value set %s failed: %s", platform, exc)
            raise
        writer.update_run(db, run_id, "ok", 1)
    finally:
        db.close()

    return f"{platform}: value={amount:,.2f}"


def get_values(*, db_path: str | Path = DB_PATH) -> dict[str, dict[str, Any]]:
    """Current value + last-updated per platform (only platforms that have
    been set at least once appear)."""
    from portfolio.db.migrate import migrate

    migrate(db_path)
    db = connect(db_path)
    try:
        rows = db.execute(
            """
            SELECT i.platform, p.market_value_ccy, p.updated_at
            FROM position p
            JOIN account a ON a.id = p.account_id
            JOIN instrument i ON i.id = p.instrument_id
            WHERE a.account_ref = ? AND i.ticker = ? AND i.platform IN ({})
            """.format(",".join("?" * len(ALLOWED_PLATFORMS))),
            (ACCOUNT_REF, TICKER, *ALLOWED_PLATFORMS),
        ).fetchall()
        return {r["platform"]: {"value": r["market_value_ccy"], "updatedAt": r["updated_at"]} for r in rows}
    finally:
        db.close()


def clear_value(platform: str, *, db_path: str | Path = DB_PATH) -> bool:
    """Remove a platform's manual value entirely (e.g. fully exited the
    broker). Returns False when there was nothing to remove."""
    from portfolio.db.migrate import migrate

    migrate(db_path)
    platform = _validate_platform(platform)
    db = connect(db_path)
    try:
        acc = db.execute(
            "SELECT id FROM account WHERE platform=? AND account_ref=?", (platform, ACCOUNT_REF)
        ).fetchone()
        inst = db.execute(
            "SELECT id FROM instrument WHERE platform=? AND ticker=?", (platform, TICKER)
        ).fetchone()
        if not acc or not inst:
            return False
        acc_id, inst_id = acc["id"], inst["id"]
        deleted = db.execute(
            "DELETE FROM position WHERE account_id=? AND instrument_id=?", (acc_id, inst_id)
        ).rowcount
        db.execute(
            "DELETE FROM position_snapshot WHERE account_id=? AND instrument_id=?", (acc_id, inst_id)
        )
        db.execute("DELETE FROM price_history WHERE instrument_id=?", (inst_id,))
        db.execute("DELETE FROM instrument WHERE id=?", (inst_id,))
        db.commit()
        return deleted > 0
    finally:
        db.close()
