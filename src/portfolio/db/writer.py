"""Write-path for the v2 relational schema.

One function per table. The snapshot orchestrator (snapshot.py) drives the flow;
these own the INSERT / ON CONFLICT details. Every fact write is keyed by a UNIQUE
constraint so re-runs (retries, racing processes) can never create junk rows:

  position            UNIQUE(account_id, instrument_id)   -> in-place upsert
  position_snapshot   UNIQUE(snapshot_date, account_id, instrument_id)
  price_history       UNIQUE(instrument_id, price_date)
  portfolio_value     UNIQUE(value_date, is_eod, scope_type, scope_key)
                      (legacy table kept for historical rows; write path
                      removed - F1, the series is derived, not stored here)
  trade               UNIQUE(account_id, external_id)
  runs                UNIQUE(platform, started_at)

Single writer + WAL (PLAN.md §3), so each call commits immediately - a crash
between calls never leaves a half-written run.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("portfolio.db.writer")


# ---- audit ----------------------------------------------------------------

def write_run(
    conn: Any,
    platform: str,
    snapshot_date: str,
    started_at: str,
    status: str = "ok",
    rows: int = 0,
    error: str | None = None,
    is_eod: bool = False,
) -> int:
    """Create a run row (lineage parent for facts). Returns its id."""
    cur = conn.execute(
        "INSERT INTO runs (platform, snapshot_date, started_at, status, rows, error, is_eod)"
        " VALUES (?,?,?,?,?,?,?)",
        (platform, snapshot_date, started_at, status, rows, error, int(is_eod)),
    )
    conn.commit()
    return cur.lastrowid


def update_run(conn: Any, run_id: int, status: str, rows: int, error: str | None = None) -> None:
    """Flip a run from 'running' to its final status."""
    conn.execute(
        "UPDATE runs SET status=?, rows=?, error=? WHERE id=?",
        (status, rows, error, run_id),
    )
    conn.commit()


# ---- dimensions ------------------------------------------------------------

def ensure_account(
    conn: Any,
    platform: str,
    label: str | None = None,
    account_ref: str = "",
    base_currency: str = "INR",
) -> int:
    """Return the account id for (platform, account_ref), creating it once.

    base_currency is the account's DISPLAY currency (zerodha -> INR,
    moomoo -> SGD); the global consolidation base is separate.
    """
    row = conn.execute(
        "SELECT id FROM account WHERE platform=? AND account_ref=?",
        (platform, account_ref),
    ).fetchone()
    if row is not None:
        conn.execute(
            "UPDATE account SET base_currency=COALESCE(?,base_currency), label=COALESCE(?,label) WHERE id=?",
            (base_currency, label, row["id"]),
        )
        conn.commit()
        return row["id"]
    cur = conn.execute(
        "INSERT INTO account (platform, account_ref, label, base_currency) VALUES (?,?,?,?)",
        (platform, account_ref, label or platform, base_currency),
    )
    conn.commit()
    return cur.lastrowid


def ensure_instrument(
    conn: Any,
    platform: str,
    ticker: str,
    *,
    isin: str | None = None,
    name: str | None = None,
    geography: str | None = None,
    currency: str,
    sector: str | None = None,
    asset_class: str | None = None,
    exchange: str | None = None,
) -> int:
    """Return the instrument id for (platform, ticker); metadata only ever improves."""
    row = conn.execute(
        "SELECT id FROM instrument WHERE platform=? AND ticker=?", (platform, ticker)
    ).fetchone()
    if row is not None:
        conn.execute(
            "UPDATE instrument SET isin=COALESCE(?,isin), name=COALESCE(?,name),"
            " geography=COALESCE(?,geography), currency=COALESCE(?,currency),"
            " sector=COALESCE(?,sector), asset_class=COALESCE(?,asset_class),"
            " exchange=COALESCE(?,exchange) WHERE id=?",
            (isin, name, geography, currency, sector, asset_class, exchange, row["id"]),
        )
        conn.commit()
        return row["id"]
    cur = conn.execute(
        "INSERT INTO instrument (platform, ticker, isin, name, geography, currency, sector, asset_class, exchange)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (platform, ticker, isin, name, geography, currency, sector, asset_class, exchange),
    )
    conn.commit()
    return cur.lastrowid


# ---- market data ------------------------------------------------------------

def ensure_fx_rate(
    conn: Any, rate_date: str, base: str, quote: str, source: str, rate: float, fetched_at: str
) -> int | None:
    """Persist one rate per (date, pair, source). Returns its id, or None when
    base == quote (identity FX needs no row - fx_rate_id stays NULL on facts)."""
    if base == quote:
        return None
    # MINOR-7: INSERT ... ON CONFLICT DO NOTHING + re-SELECT instead of
    # select-then-insert (TOCTOU). First writer keeps the stored rate; the
    # re-SELECT returns the surviving row's id either way.
    conn.execute(
        "INSERT INTO fx_rate (rate_date, base, quote, source, rate, fetched_at)"
        " VALUES (?,?,?,?,?,?)"
        " ON CONFLICT(rate_date, base, quote, source) DO NOTHING",
        (rate_date, base, quote, source, rate, fetched_at),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id FROM fx_rate WHERE rate_date=? AND base=? AND quote=? AND source=?",
        (rate_date, base, quote, source),
    ).fetchone()
    return row["id"] if row is not None else None


def upsert_price(conn: Any, instrument_id: int, price_date: str, close: float, currency: str) -> None:
    """One close per (instrument, date). EOD runs write these; intraday polls don't."""
    conn.execute(
        "INSERT INTO price_history (instrument_id, price_date, close, currency)"
        " VALUES (?,?,?,?)"
        " ON CONFLICT(instrument_id, price_date) DO UPDATE SET close=excluded.close",
        (instrument_id, price_date, close, currency),
    )
    conn.commit()


# ---- state (in-place) ----------------------------------------------------------

def upsert_position(
    conn: Any,
    account_id: int,
    instrument_id: int,
    *,
    quantity: float,
    avg_cost: float | None,
    price: float,
    cost_value_ccy: float | None,
    market_value_ccy: float,
    market_value_base: float,
    cost_value_base: float | None,
    updated_at: str,
    prev_close: float | None = None,
    day_change_ccy: float | None = None,
    day_change_pct: float | None = None,
    pnl_ccy: float | None = None,
    pnl_pct: float | None = None,
    realized_pnl_ccy: float | None = None,
    unrealized_pnl_ccy: float | None = None,
    can_sell_qty: float | None = None,
    position_side: str | None = None,
    raw_json: str | None = None,
) -> None:
    """Live holdings: one row per (account, instrument), overwritten each poll."""
    conn.execute(
        """
        INSERT INTO position (account_id, instrument_id, quantity, avg_cost, price,
                              cost_value_ccy, market_value_ccy, market_value_base,
                              cost_value_base, updated_at, prev_close, day_change_ccy,
                              day_change_pct, pnl_ccy, pnl_pct, realized_pnl_ccy,
                              unrealized_pnl_ccy, can_sell_qty, position_side, raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(account_id, instrument_id) DO UPDATE SET
          quantity=excluded.quantity, avg_cost=excluded.avg_cost, price=excluded.price,
          cost_value_ccy=excluded.cost_value_ccy, market_value_ccy=excluded.market_value_ccy,
          market_value_base=excluded.market_value_base, cost_value_base=excluded.cost_value_base,
          updated_at=excluded.updated_at, prev_close=excluded.prev_close,
          day_change_ccy=excluded.day_change_ccy, day_change_pct=excluded.day_change_pct,
          pnl_ccy=excluded.pnl_ccy, pnl_pct=excluded.pnl_pct,
          realized_pnl_ccy=excluded.realized_pnl_ccy, unrealized_pnl_ccy=excluded.unrealized_pnl_ccy,
          can_sell_qty=excluded.can_sell_qty, position_side=excluded.position_side,
          raw_json=excluded.raw_json
        """,
        (account_id, instrument_id, quantity, avg_cost, price,
         cost_value_ccy, market_value_ccy, market_value_base, cost_value_base, updated_at,
         prev_close, day_change_ccy, day_change_pct, pnl_ccy, pnl_pct,
         realized_pnl_ccy, unrealized_pnl_ccy, can_sell_qty, position_side, raw_json),
    )
    conn.commit()


# ---- history -------------------------------------------------------------------

def upsert_position_snapshot(
    conn: Any,
    run_id: int,
    account_id: int,
    instrument_id: int,
    fx_rate_id: int | None,
    snapshot_date: str,
    *,
    quantity: float,
    avg_cost: float | None,
    price: float,
    cost_value_ccy: float | None,
    market_value_ccy: float,
    market_value_base: float,
    cost_value_base: float | None,
    prev_close: float | None = None,
    day_change_ccy: float | None = None,
    day_change_pct: float | None = None,
    pnl_ccy: float | None = None,
    pnl_pct: float | None = None,
    realized_pnl_ccy: float | None = None,
    unrealized_pnl_ccy: float | None = None,
    can_sell_qty: float | None = None,
    position_side: str | None = None,
) -> None:
    """The daily ledger: one row per (date, account, instrument). EOD runs write these."""
    conn.execute(
        """
        INSERT INTO position_snapshot (run_id, account_id, instrument_id, fx_rate_id,
                                       snapshot_date, quantity, avg_cost, price,
                                       cost_value_ccy, market_value_ccy, market_value_base,
                                       cost_value_base, prev_close, day_change_ccy,
                                       day_change_pct, pnl_ccy, pnl_pct, realized_pnl_ccy,
                                       unrealized_pnl_ccy, can_sell_qty, position_side)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(snapshot_date, account_id, instrument_id) DO UPDATE SET
          run_id=excluded.run_id, quantity=excluded.quantity, avg_cost=excluded.avg_cost,
          price=excluded.price, cost_value_ccy=excluded.cost_value_ccy,
          market_value_ccy=excluded.market_value_ccy, market_value_base=excluded.market_value_base,
          cost_value_base=excluded.cost_value_base, prev_close=excluded.prev_close,
          day_change_ccy=excluded.day_change_ccy, day_change_pct=excluded.day_change_pct,
          pnl_ccy=excluded.pnl_ccy, pnl_pct=excluded.pnl_pct,
          realized_pnl_ccy=excluded.realized_pnl_ccy, unrealized_pnl_ccy=excluded.unrealized_pnl_ccy,
          can_sell_qty=excluded.can_sell_qty, position_side=excluded.position_side
        """,
        (run_id, account_id, instrument_id, fx_rate_id, snapshot_date,
         quantity, avg_cost, price, cost_value_ccy, market_value_ccy, market_value_base,
         cost_value_base, prev_close, day_change_ccy, day_change_pct, pnl_ccy, pnl_pct,
         realized_pnl_ccy, unrealized_pnl_ccy, can_sell_qty, position_side),
    )
    conn.commit()


def upsert_account_funds(
    conn: Any,
    account_id: int,
    snapshot_date: str,
    currency: str,
    *,
    total_assets_ccy: float | None,
    market_value_ccy: float | None,
    cash_ccy: float | None,
    buying_power_ccy: float | None,
    fetched_at: str,
) -> None:
    """One funds row per (account, day, currency); today's values overwrite."""
    conn.execute(
        """
        INSERT INTO account_funds (account_id, snapshot_date, currency, total_assets_ccy,
                                   market_value_ccy, cash_ccy, buying_power_ccy, fetched_at)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(account_id, snapshot_date, currency) DO UPDATE SET
          total_assets_ccy=excluded.total_assets_ccy, market_value_ccy=excluded.market_value_ccy,
          cash_ccy=excluded.cash_ccy, buying_power_ccy=excluded.buying_power_ccy,
          fetched_at=excluded.fetched_at
        """,
        (account_id, snapshot_date, currency, total_assets_ccy,
         market_value_ccy, cash_ccy, buying_power_ccy, fetched_at),
    )
    conn.commit()


# ---- trades (daily capture for XIRR) ----------------------------------------

# upsert_trade lives below ("cash flows (XIRR input, M3)"): it returns bool
# (True = inserted) so the capture can count new vs seen, and dedupes via
# UNIQUE(account_id, external_id) with ON CONFLICT DO NOTHING.


# ---- cash flows (XIRR input, M3) -----------------------------------------------

def upsert_trade(
    conn: Any,
    run_id: int,
    account_id: int,
    instrument_id: int,
    *,
    trade_date: str,
    quantity: float,
    price: float,
    amount_ccy: float,
    currency: str,
    external_id: str,
) -> bool:
    """Insert one trade row; returns False when the external_id already exists.

    trade.quantity and trade.amount_ccy are SIGNED (+buy / -sell) - the XIRR
    solver reads them as cash flows. Dedupe is UNIQUE(account_id, external_id):
    daily capture is idempotent, so a re-run today inserts nothing new.
    """
    if not external_id:
        raise ValueError("trade upsert requires a broker external_id (dedupe key)")
    cur = conn.execute(
        "INSERT INTO trade (run_id, account_id, instrument_id, trade_date,"
        " quantity, price, amount_ccy, currency, external_id)"
        " VALUES (?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(account_id, external_id) DO NOTHING",
        (run_id, account_id, instrument_id, trade_date,
         quantity, price, amount_ccy, currency, external_id),
    )
    conn.commit()
    return cur.rowcount > 0
