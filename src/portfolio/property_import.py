"""Property import — manual valuation entry for real estate (MVP).

Real estate is tracked as a holding with asset_class="real_estate", using the
same unified pipeline as CAS imports and broker snapshots:

  property JSON -> Holding (common schema) + trade rows (cash flows for XIRR)
  -> position (live state) + position_snapshot (monthly ledger) + trade (XIRR input)

Property JSON format (manual entry, gitignored data/properties/):
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

Cash flows generated for XIRR (signed: +buy/-sell convention in trade.amount_ccy):
  - Purchase: -purchase_price on purchase_date
  - Each improvement: -amount on improvement date
  - Terminal: +current_valuation on valuation_date (today)

Mortgage support is Phase 2 (future): mortgage table + amortization trades.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from portfolio.config import DB_PATH
from portfolio.db import connect, writer
from portfolio.db.persist import persist
from portfolio.normalize.schema import Holding, to_float

logger = logging.getLogger("portfolio.property")


def read_property_json(json_path: str | Path) -> dict[str, Any]:
    """Parse a property JSON file."""
    with Path(json_path).open(encoding="utf-8") as f:
        return json.load(f)


def _to_float(value: Any) -> float | None:
    return to_float(value)


def build_holding_and_trades(
    prop: dict[str, Any],
    *,
    valuation_date: str | None = None,
) -> tuple[Holding, list[dict[str, Any]]]:
    """Convert property JSON to a Holding + list of trade dicts for XIRR.

    Returns (holding, trades) where trades is a list of dicts with keys:
    trade_date, quantity, price, amount_ccy, currency, external_id
    """
    property_id = prop["property_id"]
    address = prop["address"]
    property_type = prop.get("property_type", "residential")
    purchase_date = prop["purchase_date"]
    purchase_price = _to_float(prop["purchase_price"])
    current_valuation = _to_float(prop["current_valuation"])
    improvements = prop.get("improvements", [])

    if not all([property_id, address, purchase_date, purchase_price is not None, current_valuation is not None]):
        raise ValueError("property JSON missing required fields: property_id, address, purchase_date, purchase_price, current_valuation")

    # Valuation date defaults to today (Kolkata date for consistency with CAS)
    if valuation_date is None:
        valuation_date = datetime.now(UTC).astimezone().date().isoformat()

    # --- Build Holding ---
    # Use property_id as ticker (maps to instrument.ticker)
    # Use property_id as ISIN equivalent for sector map key
    holding = Holding(
        platform="real_estate",  # dedicated platform for property leg
        geography="IN",
        ticker=property_id,
        name=address,
        quantity=1.0,  # one property = 1 unit
        avg_price=purchase_price,
        current_price=current_valuation,
        cost_basis=purchase_price + sum(_to_float(imp.get("amount")) or 0.0 for imp in improvements),
        current_value=current_valuation,
        currency="INR",
        sector=property_type.capitalize(),  # "Residential" / "Commercial"
        asset_class="real_estate",
        isin=property_id,  # use property_id as ISIN key for sectors.csv
        exchange=None,
    )

    # --- Build trade rows for XIRR ---
    # Convention: trade.amount_ccy is SIGNED (+buy / -sell)
    # XIRR solver expects flows = -amount_ccy (buy = outflow, sell = inflow)
    # So purchase (outflow) -> amount_ccy = +purchase_price
    # Improvement (outflow) -> amount_ccy = +amount
    # Terminal (as-if-sold, inflow) -> amount_ccy = -current_valuation
    trades: list[dict[str, Any]] = []

    # Purchase trade
    trades.append({
        "trade_date": purchase_date,
        "quantity": 1.0,
        "price": purchase_price,
        "amount_ccy": purchase_price,  # +ve = buy (outflow from investor pocket)
        "currency": "INR",
        "external_id": f"purchase_{property_id}",
    })

    # Improvement trades
    for i, imp in enumerate(improvements):
        imp_amount = _to_float(imp.get("amount"))
        imp_date = imp.get("date")
        if imp_amount is not None and imp_date:
            trades.append({
                "trade_date": imp_date,
                "quantity": 0.0,  # no change in unit count
                "price": 0.0,
                "amount_ccy": imp_amount,  # +ve = capital improvement (outflow)
                "currency": "INR",
                "external_id": f"improvement_{property_id}_{i+1}",
            })

    # Terminal trade (as-if-sold on valuation date)
    trades.append({
        "trade_date": valuation_date,
        "quantity": -1.0,  # liquidate the 1 unit
        "price": current_valuation,
        "amount_ccy": -current_valuation,  # -ve = sell (inflow to investor pocket)
        "currency": "INR",
        "external_id": f"terminal_{property_id}_{valuation_date}",
    })

    return holding, trades


def import_property(
    json_path: str | Path,
    db_path: str | Path = DB_PATH,
    *,
    valuation_date: str | None = None,
) -> str:
    """Parse a property JSON and persist holding + trades to the DB.

    Uses db.persist.persist for the holding (writes position + position_snapshot
    + price_history at is_eod=True) and writer.upsert_trade for the cash flows.

    Returns a summary string for CLI output.
    """
    from portfolio.db.migrate import migrate

    migrate(db_path)  # idempotent - property import must work on a fresh DB
    prop = read_property_json(json_path)

    if valuation_date is None:
        valuation_date = datetime.now(UTC).astimezone().date().isoformat()

    holding, trades = build_holding_and_trades(prop, valuation_date=valuation_date)

    db = connect(db_path)
    try:
        # Run audit: one row per import (platform='real_estate')
        run_at = datetime.now(UTC).replace(microsecond=0).isoformat()
        run_id = writer.write_run(
            db, "real_estate", valuation_date, run_at, "running", is_eod=True
        )
        try:
            # Persist the holding (position + snapshot + price_history)
            persist(
                db, run_id, run_at, [holding], valuation_date, "INR",
                is_eod=True, account_ref="folio",  # single property folio
            )

            # Persist trades for XIRR
            account_id = writer.ensure_account(
                db, "real_estate", account_ref="folio", base_currency="INR"
            )
            instrument_id = writer.ensure_instrument(
                db, "real_estate", holding.ticker,
                name=holding.name, geography=holding.geography, currency=holding.currency,
                sector=holding.sector, asset_class=holding.asset_class,
                isin=holding.isin, exchange=holding.exchange,
            )

            new_trades = 0
            for t in trades:
                inserted = writer.upsert_trade(
                    db, run_id, account_id, instrument_id,
                    trade_date=t["trade_date"],
                    quantity=t["quantity"],
                    price=t["price"],
                    amount_ccy=t["amount_ccy"],
                    currency=t["currency"],
                    external_id=t["external_id"],
                )
                if inserted:
                    new_trades += 1

            writer.update_run(db, run_id, "ok", 1)  # 1 holding row
        except Exception as exc:
            writer.update_run(db, run_id, "error", 0, error=str(exc))
            logger.error("property import failed: %s", exc)
            raise
    finally:
        db.close()

    parts = [
        f"property={prop['property_id']}",
        f"address={prop['address']}",
        f"purchase={prop['purchase_price']:,}",
        f"current={prop['current_valuation']:,}",
        f"simple_return={((prop['current_valuation'] - prop['purchase_price']) / prop['purchase_price'] * 100):.1f}%",
        f"trades_written={new_trades}",
    ]
    return " | ".join(parts)


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("usage: python -m portfolio.property_import <property.json> [valuation_date]")
        sys.exit(1)
    json_path = sys.argv[1]
    val_date = sys.argv[2] if len(sys.argv) > 2 else None
    print(import_property(json_path, valuation_date=val_date))