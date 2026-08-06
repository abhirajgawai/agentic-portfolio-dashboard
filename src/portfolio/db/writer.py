"""Write-path for the v2 relational schema.

One function per table. The snapshot orchestrator (snapshot.py) drives the flow;
these own the INSERT / ON CONFLICT details. Every fact write is keyed by a UNIQUE
constraint so re-runs (retries, racing processes) can never create junk rows:

  position            UNIQUE(account_id, instrument_id)   -> in-place upsert
  position_snapshot   UNIQUE(snapshot_date, account_id, instrument_id)
  price_history       UNIQUE(instrument_id, price_date)
  portfolio_value     UNIQUE(value_date, is_eod, scope_type, scope_key)
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

def ensure_account(conn: Any, platform: str, label: str | None = None, account_ref: str = "") -> int:
    """Return the account id for (platform, account_ref), creating it once."""
    row = conn.execute(
        "SELECT id FROM account WHERE platform=? AND account_ref=?",
        (platform, account_ref),
    ).fetchone()
    if row is not None:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO account (platform, account_ref, label) VALUES (?,?,?)",
        (platform, account_ref, label or platform),
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
) -> int:
    """Return the instrument id for (platform, ticker); metadata only ever improves."""
    row = conn.execute(
        "SELECT id FROM instrument WHERE platform=? AND ticker=?", (platform, ticker)
    ).fetchone()
    if row is not None:
        conn.execute(
            "UPDATE instrument SET isin=COALESCE(?,isin), name=COALESCE(?,name),"
            " geography=COALESCE(?,geography), currency=COALESCE(?,currency),"
            " sector=COALESCE(?,sector), asset_class=COALESCE(?,asset_class) WHERE id=?",
            (isin, name, geography, currency, sector, asset_class, row["id"]),
        )
        conn.commit()
        return row["id"]
    cur = conn.execute(
        "INSERT INTO instrument (platform, ticker, isin, name, geography, currency, sector, asset_class)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (platform, ticker, isin, name, geography, currency, sector, asset_class),
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
    row = conn.execute(
        "SELECT id FROM fx_rate WHERE rate_date=? AND base=? AND quote=? AND source=?",
        (rate_date, base, quote, source),
    ).fetchone()
    if row is not None:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO fx_rate (rate_date, base, quote, source, rate, fetched_at) VALUES (?,?,?,?,?,?)",
        (rate_date, base, quote, source, rate, fetched_at),
    )
    conn.commit()
    return cur.lastrowid


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
    updated_at: str,
) -> None:
    """Live holdings: one row per (account, instrument), overwritten each poll."""
    conn.execute(
        """
        INSERT INTO position (account_id, instrument_id, quantity, avg_cost, price,
                              cost_value_ccy, market_value_ccy, market_value_base, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(account_id, instrument_id) DO UPDATE SET
          quantity=excluded.quantity, avg_cost=excluded.avg_cost, price=excluded.price,
          cost_value_ccy=excluded.cost_value_ccy, market_value_ccy=excluded.market_value_ccy,
          market_value_base=excluded.market_value_base, updated_at=excluded.updated_at
        """,
        (account_id, instrument_id, quantity, avg_cost, price,
         cost_value_ccy, market_value_ccy, market_value_base, updated_at),
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
) -> None:
    """The daily ledger: one row per (date, account, instrument). EOD runs write these."""
    conn.execute(
        """
        INSERT INTO position_snapshot (run_id, account_id, instrument_id, fx_rate_id,
                                       snapshot_date, quantity, avg_cost, price,
                                       cost_value_ccy, market_value_ccy, market_value_base)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(snapshot_date, account_id, instrument_id) DO UPDATE SET
          run_id=excluded.run_id, quantity=excluded.quantity, avg_cost=excluded.avg_cost,
          price=excluded.price, cost_value_ccy=excluded.cost_value_ccy,
          market_value_ccy=excluded.market_value_ccy, market_value_base=excluded.market_value_base
        """,
        (run_id, account_id, instrument_id, fx_rate_id, snapshot_date,
         quantity, avg_cost, price, cost_value_ccy, market_value_ccy, market_value_base),
    )
    conn.commit()


def upsert_portfolio_value(
    conn: Any,
    value_date: str,
    is_eod: bool,
    scope_type: str,
    scope_key: str,
    value_base: float,
) -> None:
    """Compact value series: total portfolio value per (date, scope). Feeds the charts."""
    conn.execute(
        """
        INSERT INTO portfolio_value (value_date, is_eod, scope_type, scope_key, value_base)
        VALUES (?,?,?,?,?)
        ON CONFLICT(value_date, is_eod, scope_type, scope_key) DO UPDATE SET value_base=excluded.value_base
        """,
        (value_date, int(is_eod), scope_type, scope_key, value_base),
    )
    conn.commit()
