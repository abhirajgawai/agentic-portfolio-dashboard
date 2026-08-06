"""Export the latest snapshot to the M8 dashboard JSON contract.

Produces dashboard/public/data/latest.json from the SQLite DB. Every run ends
with this (the plan's deterministic dashboard path - the UI never touches a
broker or the LLM).

The account-currency view: each brokerage leg is shown in its own currency
(zerodha -> INR, moomoo -> SGD), while the whole portfolio consolidates in the
global base (INR). Moomoo holdings are USD-denominated, so the SGD display
value converts via USD->SGD = (INR/USD)/(INR/SGD), both from the same run's
fx_rates rows.
"""

from __future__ import annotations

import json
from pathlib import Path

from portfolio.config import DB_PATH, ROOT_DIR, Settings
from portfolio.db import connect

OUT = ROOT_DIR / "dashboard" / "public" / "data" / "latest.json"


def load_fx(conn) -> dict[str, float]:
    """Latest INR/USD + INR/SGD from fx_rates (deterministic - never re-fetch)."""
    rows = conn.execute(
        "SELECT quote, rate FROM fx_rate WHERE base='INR' ORDER BY rate_date DESC, id DESC"
    ).fetchall()
    rates: dict[str, float] = {}
    for r in rows:
        if r["quote"] in ("USD", "SGD") and r["quote"] not in rates:
            rates[r["quote"]] = r["rate"]
    return rates


def export(db_path: Path = DB_PATH, out: Path = OUT) -> Path:
    conn = connect(db_path)
    try:
        base = Settings().base_currency
        fx = load_fx(conn)
        usd_inr = fx.get("USD", 1.0)
        sgd_inr = fx.get("SGD", 1.0)
        usd_to_sgd = usd_inr / sgd_inr if sgd_inr else 1.0

        rows = conn.execute(
            """
            SELECT a.platform, a.base_currency AS account_currency,
                   i.ticker, i.name, i.geography, i.currency, i.sector, i.asset_class,
                   p.quantity, p.avg_cost, p.price, p.cost_value_ccy,
                   p.market_value_ccy, p.market_value_base, p.cost_value_base
            FROM position p
            JOIN instrument i ON i.id = p.instrument_id
            JOIN account a ON a.id = p.account_id
            ORDER BY a.platform, p.market_value_base DESC
            """
        ).fetchall()

        holdings = []
        for r in rows:
            ccy = r["currency"]
            # Display value in the ACCOUNT's currency (INR leg -> INR, SGD leg -> SGD).
            if r["account_currency"] == "SGD" and ccy == "USD":
                value_display = r["market_value_ccy"] * usd_to_sgd
            else:
                value_display = r["market_value_base"]  # base==account ccy here
            return_pct = None
            if r["cost_value_base"]:
                return_pct = (r["market_value_base"] - r["cost_value_base"]) / r["cost_value_base"] * 100.0
            holdings.append(
                {
                    "platform": r["platform"],
                    "geography": r["geography"],
                    "ticker": r["ticker"],
                    "name": r["name"],
                    "qty": r["quantity"],
                    "avgPrice": r["avg_cost"],
                    "ltp": r["price"],
                    "value": r["market_value_ccy"],
                    "valueBase": r["market_value_base"],
                    "valueDisplay": value_display,
                    "displayCurrency": r["account_currency"],
                    "returnPct": round(return_pct, 2) if return_pct is not None else None,
                    "sector": r["sector"],
                    "assetClass": r["asset_class"],
                }
            )

        totals_base = sum(h["valueBase"] for h in holdings)
        by_account_currency: dict[str, float] = {}
        by_platform: dict[str, float] = {}
        by_geography: dict[str, float] = {}
        by_sector: dict[str, float] = {}
        by_asset_class: dict[str, float] = {}
        for h in holdings:
            by_account_currency[h["displayCurrency"]] = by_account_currency.get(h["displayCurrency"], 0.0) + h["valueBase"]
            by_platform[h["platform"]] = by_platform.get(h["platform"], 0.0) + h["valueBase"]
            by_geography[h["geography"]] = by_geography.get(h["geography"], 0.0) + h["valueBase"]
            by_sector[h["sector"] or "unknown"] = by_sector.get(h["sector"] or "unknown", 0.0) + h["valueBase"]
            by_asset_class[h["assetClass"] or "unknown"] = by_asset_class.get(h["assetClass"] or "unknown", 0.0) + h["valueBase"]

        def _pct(d: dict[str, float]) -> dict[str, float]:
            return {k: round(v / totals_base * 100.0, 2) for k, v in sorted(d.items())} if totals_base else {}

        payload = {
            "asOf": conn.execute("SELECT MAX(started_at) t FROM runs").fetchone()["t"],
            "baseCurrency": base,
            "fx": {"USDINR": usd_inr, "SGDINR": sgd_inr, "USD_SGD": usd_to_sgd},
            "totals": {
                "valueBase": round(totals_base, 2),
                "byAccountCurrency": {k: round(v, 2) for k, v in by_account_currency.items()},
                "dayPnl": None,  # derivable once price_history has >= 2 days (M5)
            },
            "allocation": {
                "byAccountCurrency": _pct(by_account_currency),
                "byGeography": _pct(by_geography),
                "byPlatform": _pct(by_platform),
                "bySector": _pct(by_sector),
                "byAssetClass": _pct(by_asset_class),
            },
            "holdings": holdings,
        }
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return out
    finally:
        conn.close()


if __name__ == "__main__":
    path = export()
    print(f"exported -> {path}")
