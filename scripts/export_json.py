"""Export the latest snapshot to the M8 dashboard JSON contract.

Produces dashboard/public/data/latest.json + history.json from the SQLite DB.
Every run ends with this (the plan's deterministic dashboard path - the UI
never touches a broker or the LLM).

The account-currency view: each brokerage leg is shown in its own currency
(zerodha -> INR, moomoo -> SGD), while the whole portfolio consolidates in the
global base (INR). Moomoo holdings are USD-denominated, so the SGD display
value converts via USD->SGD = (INR/USD)/(INR/SGD), both from the same run's
fx_rates rows.

Freshness (M-4): mixed-frequency legs have different ages, so one `asOf` over
all runs would be a lie. latest.json now carries:
  - asOf            = MAX(runs.started_at) over status='ok' runs only
  - per-holding asOf = that position's updated_at (per-holding truth)
  - platforms       = {name: {asOf, stale}} with a staleness threshold per
                      platform (brokers ~2 days, CAS platforms ~35 days)

history.json is the DERIVED value series (portfolio.series, M-3): per date, per
scope sums of position_snapshot.market_value_base - honest with mixed-frequency
legs by construction, unlike the legacy portfolio_value writes.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from portfolio.config import DB_PATH, ROOT_DIR, Settings
from portfolio.db import connect
from portfolio.series import portfolio_series

OUT = ROOT_DIR / "dashboard" / "public" / "data" / "latest.json"
OUT_HISTORY = ROOT_DIR / "dashboard" / "public" / "data" / "history.json"

# Staleness thresholds (days) per platform: brokers refresh daily, CAS platforms
# refresh on the monthly import cadence (M-4). Positions older than this mark the
# platform `stale: true` in the payload.
PLATFORM_STALE_DAYS: dict[str, int] = {
    "zerodha": 2,  # live MCP leg - daily
    "moomoo": 2,  # OpenD leg - daily
    "groww": 35,  # CAS import - monthly statement
    "sharekhan": 35,  # CAS import - monthly statement
}
DEFAULT_STALE_DAYS = 2


def load_fx(conn) -> dict[str, float]:
    """Latest INR/USD + INR/SGD from the SAME rate_date (deterministic).

    MINOR-5: picking the latest USD and the latest SGD independently could
    divide a month-old SGD into today's USD. Both rates come from the most
    recent rate_date that has BOTH rows.
    """
    row = conn.execute(
        "SELECT rate_date FROM fx_rate WHERE base='INR' AND quote IN ('USD','SGD')"
        " GROUP BY rate_date HAVING COUNT(DISTINCT quote) = 2"
        " ORDER BY rate_date DESC LIMIT 1"
    ).fetchone()
    if row is None:
        return {}
    return {
        r["quote"]: r["rate"]
        for r in conn.execute(
            "SELECT quote, rate FROM fx_rate WHERE base='INR' AND rate_date=?"
            " AND quote IN ('USD','SGD')",
            (row["rate_date"],),
        )
    }


def _is_stale(as_of: str | None, max_age_days: int, now: datetime) -> bool:
    """True when an ISO-8601 timestamp is older than max_age_days."""
    if not as_of:
        return True
    try:
        age = now - datetime.fromisoformat(as_of)
    except ValueError:
        return True  # unparseable timestamp -> treat as stale, never claim fresh
    return age.days > max_age_days


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
                   i.ticker, i.name, i.geography, i.currency, i.sector, i.asset_class, i.isin,
                   p.quantity, p.avg_cost, p.price, p.cost_value_ccy,
                   p.market_value_ccy, p.market_value_base, p.cost_value_base,
                   p.day_change_ccy, p.day_change_pct, p.pnl_ccy, p.pnl_pct,
                   p.can_sell_qty, p.position_side, p.updated_at
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
                    "isin": r["isin"],
                    "currency": ccy,
                    "qty": r["quantity"],
                    "avgPrice": r["avg_cost"],
                    "ltp": r["price"],
                    "value": r["market_value_ccy"],
                    "valueBase": r["market_value_base"],
                    "valueDisplay": value_display,
                    "displayCurrency": r["account_currency"],
                    "asOf": r["updated_at"],  # per-holding truth (M-4)
                    "returnPct": round(return_pct, 2) if return_pct is not None else None,
                    "dayPnl": r["day_change_ccy"],
                    "dayChangePct": round(r["day_change_pct"], 2) if r["day_change_pct"] is not None else None,
                    "pnl": r["pnl_ccy"],
                    "pnlPct": round(r["pnl_pct"], 2) if r["pnl_pct"] is not None else None,
                    "canSellQty": r["can_sell_qty"],
                    "positionSide": r["position_side"],
                    "sector": r["sector"],
                    "assetClass": r["asset_class"],
                }
            )

        # day P&L: per holding it is in the HOLDING's currency; convert to the
        # account's display currency (SGD leg) and to the base (consolidated).
        def _to(currency: str, amount: float | None, target: str) -> float:
            if amount is None:
                return 0.0
            if currency == "USD":
                return amount * (usd_to_sgd if target == "SGD" else usd_inr)
            return amount  # INR stays INR in every target

        day_pnl_base = sum(_to(h["currency"], h["dayPnl"], "INR") for h in holdings)
        day_pnl_by_currency: dict[str, float] = {}

        totals_base = sum(h["valueBase"] for h in holdings)
        by_account_currency: dict[str, float] = {}
        by_platform: dict[str, float] = {}
        by_geography: dict[str, float] = {}
        by_sector: dict[str, float] = {}
        by_asset_class: dict[str, float] = {}
        for h in holdings:
            by_account_currency[h["displayCurrency"]] = by_account_currency.get(h["displayCurrency"], 0.0) + h["valueBase"]
            day_pnl_by_currency[h["displayCurrency"]] = day_pnl_by_currency.get(h["displayCurrency"], 0.0) + _to(
                h["currency"], h["dayPnl"], h["displayCurrency"]
            )
            by_platform[h["platform"]] = by_platform.get(h["platform"], 0.0) + h["valueBase"]
            by_geography[h["geography"]] = by_geography.get(h["geography"], 0.0) + h["valueBase"]
            by_sector[h["sector"] or "unknown"] = by_sector.get(h["sector"] or "unknown", 0.0) + h["valueBase"]
            by_asset_class[h["assetClass"] or "unknown"] = by_asset_class.get(h["assetClass"] or "unknown", 0.0) + h["valueBase"]

        def _pct(d: dict[str, float]) -> dict[str, float]:
            return {k: round(v / totals_base * 100.0, 2) for k, v in sorted(d.items())} if totals_base else {}

        # M-4: asOf must reflect only SUCCESSFUL runs - an error/stale row can
        # be newer than the data it failed to refresh.
        as_of = conn.execute(
            "SELECT MAX(started_at) t FROM runs WHERE status='ok'"
        ).fetchone()["t"]
        now = datetime.now(UTC)

        # M-4: per-platform freshness = max position.updated_at on that platform,
        # with a staleness threshold (brokers 2d, CAS platforms 35d).
        platforms: dict[str, dict] = {}
        for r in conn.execute(
            "SELECT a.platform, MAX(p.updated_at) AS as_of FROM position p"
            " JOIN account a ON a.id = p.account_id GROUP BY a.platform"
        ).fetchall():
            name = r["platform"]
            platforms[name] = {
                "asOf": r["as_of"],
                "stale": _is_stale(r["as_of"], PLATFORM_STALE_DAYS.get(name, DEFAULT_STALE_DAYS), now),
            }

        payload = {
            "asOf": as_of,
            "baseCurrency": base,
            "fx": {"USDINR": usd_inr, "SGDINR": sgd_inr, "USD_SGD": usd_to_sgd},
            "platforms": platforms,
            "totals": {
                "valueBase": round(totals_base, 2),
                "byAccountCurrency": {k: round(v, 2) for k, v in by_account_currency.items()},
                "dayPnl": round(day_pnl_base, 2),
                "dayPnlByAccountCurrency": {k: round(v, 2) for k, v in day_pnl_by_currency.items()},
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

        # M-3: history.json is the DERIVED series (honest with mixed-frequency
        # legs), not the legacy clobber-prone portfolio_value rows.
        history = portfolio_series(conn, base)
        OUT_HISTORY.parent.mkdir(parents=True, exist_ok=True)
        OUT_HISTORY.write_text(json.dumps(history, indent=2), encoding="utf-8")
        return out
    finally:
        conn.close()


if __name__ == "__main__":
    path = export()
    print(f"exported -> {path}")
    print(f"exported -> {OUT_HISTORY}")
