"""CAS import (M3) — the free, complete Groww/IN holdings path.

The Consolidated Account Statement (CAS) is SEBI-mandated, emailed monthly,
and covers every demat account (CDSL + NSDL) plus every mutual fund folio
(CAMS/KFintech) under one PAN. Parsed fully offline by the MIT `casparser`
library (codereverser/casparser) — the PDF never leaves this machine.

What a demat-consolidated CAS gives us per holding (verified against the real
June 2026 statement, data/cas/CAS-June2026.json):
  equities   -> isin, name, num_shares, price, value, symbol, exchange
                 (current VALUE only — the CAS carries no cost basis)
  demat MFs  -> isin, balance (units), nav, value            (no cost basis)
  folio MFs  -> isin, scheme name, balance, nav, value,
                 avg_cost, total_cost, pnl                    (FULL returns)

So folio MFs give per-holding returns directly; equities and demat MFs give
current value with returns marked N/A until a cost source exists (the M5
returns engine treats cost_basis=None as value-only).

Platform attribution is by Depository Participant (DP) id — verified against
the June 2026 statement:
  GROWW INVEST TECH (CDSL dp 12088700) -> `groww`  (the user's demat MFs)
  "Mutual Fund Folios" (CAMS/KFintech)  -> `groww`  (user's MF distributor)
  SHAREKHAN (NSDL dp IN300513)          -> `sharekhan`
  ZERODHA (CDSL dp 12081600)            -> equities SKIPPED (the live MCP leg
     already captures them — importing would double-count), but the account's
     demat MFs ARE imported (no live leg captures MFs).

Sector/asset_class enrichment comes from the same curated data/sectors.csv the
live legs use (portfolio.normalize.sectors.load_sectors). Equities are keyed by
symbol; MFs are keyed by ISIN because the demat-MF ticker IS the ISIN.

Deterministic: same PDF -> same rows. No LLM, no network (AMFI name
enrichment is optional and best-effort).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from portfolio.config import DB_PATH, Settings
from portfolio.db import connect, writer
from portfolio.normalize.schema import Holding, to_float
from portfolio.normalize.sectors import load_sectors

logger = logging.getLogger("portfolio.cas")

# DP id -> platform (verified against the June 2026 CAS).
CAS_PLATFORM_BY_DP = {
    "12081600": "zerodha",  # equities skipped (live MCP); MFs imported
    "12088700": "groww",  # Groww demat MFs
    "IN300513": "sharekhan",  # NSDL demat equities
}
# The folios pseudo-account holds CAMS/KFintech folios - the user's MF
# distributor is Groww, so folio MFs land under platform `groww`.
FOLIO_PLATFORM = "groww"
FOLIO_ACCOUNT_REF = "folio"

# Platforms whose equities are captured LIVE by MCP legs - CAS equities for
# them would double-count (same instrument in two accounts).
LIVE_EQUITY_PLATFORMS = frozenset({"zerodha"})


def _num(value: Any) -> float | None:
    """casparser serialises decimals as JSON strings; coerce to float."""
    return to_float(value)


def _clean_name(name: Any) -> str | None:
    """'ADANI POWER LIMITED#NEW EQUITY SHARES WITH FACE VALUE RS.2/- ...' -> base name."""
    if not name:
        return None
    return str(name).split("#")[0].strip() or None


# A bare AMC name ("HDFC MUTUAL FUND") vs a real scheme name ("HDFC Mid Cap
# Fund - Growth Option - Direct Plan"). The CAS demat-MF section prints only
# the AMC; the AMFI feed has the actual scheme name we prefer.
_AMC_ONLY = re.compile(r"^[A-Z0-9 .&()'\-]{2,40}\s+MUTUAL FUND$")


def _is_amc_only(name: str | None) -> bool:
    return bool(name and _AMC_ONLY.match(name.strip().upper()))


def read_cas(pdf_path: str | Path, password: str = "") -> dict[str, Any]:
    """Parse a CAS PDF with casparser; returns the dict-shaped model dump."""
    import casparser

    model = casparser.read_cas_pdf(str(pdf_path), password)
    return model.model_dump(mode="json")


def statement_end_date(raw: Mapping[str, Any]) -> str:
    """'30-Jun-2026' -> '2026-06-30' (the snapshot date for persisted rows)."""
    period = raw.get("statement_period") or {}
    end = period.get("to") or period.get("to_") or ""
    try:
        return datetime.strptime(str(end).strip(), "%d-%b-%Y").date().isoformat()
    except ValueError:
        raise ValueError(f"cannot parse CAS statement end date: {end!r}") from None


def _platform_for(account: Mapping[str, Any]) -> str:
    name = str(account.get("name") or "")
    if "folio" in name.lower():
        return FOLIO_PLATFORM
    dp = str(account.get("dp_id") or "")
    if dp in CAS_PLATFORM_BY_DP:
        return CAS_PLATFORM_BY_DP[dp]
    # Unknown DP: fall back to a slug of the account name (e.g. "sharekhan").
    return "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_") or "demat"


def _account_ref_for(account: Mapping[str, Any]) -> str:
    name = str(account.get("name") or "")
    if "folio" in name.lower():
        return FOLIO_ACCOUNT_REF
    return str(account.get("client_id") or "")


def extract_holdings(
    raw: Mapping[str, Any],
    *,
    nav_names: Mapping[str, str] | None = None,
    sectors: Mapping[str, tuple[str | None, str | None]] | None = None,
) -> tuple[dict[tuple[str, str], list[Holding]], dict[str, Any]]:
    """Map a parsed CAS to common-schema Holdings, grouped by (platform,
    account_ref) so each broker account becomes one DB account.

    `sectors` is the curated {ticker -> (sector, asset_class)} map from
    data/sectors.csv: equities look up by symbol, MFs by ISIN. None -> {} (the
    caller decides; import_cas loads the real map for the pipeline path).

    Returns (groups, stats) where stats reports how many rows carry a cost
    basis (returns computable) vs value-only, and how many zerodha equities
    were skipped as live-captured.
    """
    nav_names = nav_names or {}
    sectors = sectors or {}
    groups: dict[tuple[str, str], list[Holding]] = {}
    stats: dict[str, Any] = {"cost_known": 0, "cost_missing": 0, "skipped_zerodha_equities": 0, "by_platform": {}}

    for account in raw.get("accounts") or []:
        platform = _platform_for(account)
        account_ref = _account_ref_for(account)
        key = (platform, account_ref)
        groups.setdefault(key, [])
        stats["by_platform"][platform] = stats["by_platform"].get(platform, 0)

        for item in account.get("equities") or []:
            if platform in LIVE_EQUITY_PLATFORMS:
                stats["skipped_zerodha_equities"] += 1
                continue
            holding = _equity_holding(item, platform, sectors)
            if holding is not None:
                groups[key].append(holding)
                stats["by_platform"][platform] += 1
                stats["cost_missing"] += 1  # CAS equities never carry cost

        for item in account.get("mutual_funds") or []:
            holding = _mf_holding(item, platform, nav_names, sectors)
            if holding is not None:
                groups[key].append(holding)
                stats["by_platform"][platform] += 1
                if holding.cost_basis is not None:
                    stats["cost_known"] += 1
                else:
                    stats["cost_missing"] += 1
    return {k: v for k, v in groups.items() if v}, stats


def _equity_holding(
    item: Mapping[str, Any], platform: str, sectors: Mapping[str, tuple[str | None, str | None]]
) -> Holding | None:
    isin = item.get("isin")
    ticker = item.get("symbol") or isin
    quantity = _num(item.get("num_shares"))
    price = _num(item.get("price"))
    value = _num(item.get("value"))
    if not ticker or quantity is None or price is None:
        logger.warning("cas equity row without ticker/qty/price skipped: %s", isin)
        return None
    # Curated map is keyed by trading symbol for equities.
    sector, csv_asset = sectors.get(str(ticker), (None, None))
    return Holding(
        platform=platform,
        geography="IN",
        ticker=str(ticker),
        name=_clean_name(item.get("name")),
        quantity=quantity,
        avg_price=None,  # CAS carries no cost basis for equities
        current_price=price,
        cost_basis=None,
        current_value=value if value is not None else price * quantity,
        currency="INR",
        sector=sector,  # None when unmapped - "unknown" is a dashboard-only label
        asset_class=csv_asset or "equity",
    )


def _mf_holding(
    item: Mapping[str, Any],
    platform: str,
    nav_names: Mapping[str, str],
    sectors: Mapping[str, tuple[str | None, str | None]],
) -> Holding | None:
    isin = item.get("isin")
    units = _num(item.get("balance"))
    nav = _num(item.get("nav"))
    value = _num(item.get("value"))
    if not isin or units is None or nav is None:
        logger.warning("cas mf row without isin/units/nav skipped: %s", isin)
        return None
    # Demat MF rows carry only the AMC name ("AXIS MUTUAL FUND"); the AMFI
    # feed has the real scheme name - prefer it over a bare AMC name.
    pdf_name = item.get("name")
    amfi_name = nav_names.get(str(isin))
    name = _clean_name(amfi_name or (pdf_name if not _is_amc_only(pdf_name) else None))
    # Gold/silver ETFs live in the same demat-MF section; classify by name.
    # The CSV's asset_class wins when present (consistent with snapshot.py).
    sector, csv_asset = sectors.get(str(isin), (None, None))
    asset_class = csv_asset or ("etf" if name and "ETF" in name.upper() else "mutual_fund")
    return Holding(
        platform=platform,
        geography="IN",
        ticker=str(isin),
        name=name,
        quantity=units,
        avg_price=_num(item.get("avg_cost")),  # folio rows carry it; demat None
        current_price=nav,
        cost_basis=_num(item.get("total_cost")),  # folio rows carry it; demat None
        current_value=value if value is not None else nav * units,
        currency="INR",
        sector=sector,  # fund category (Flexi Cap, Gold, ...) - None when unmapped
        asset_class=asset_class,
    )


def import_cas(
    pdf_path: str | Path,
    db_path: str | Path = DB_PATH,
    password: str = "",
    *,
    enrich_names: bool = True,
    sectors: Mapping[str, tuple[str | None, str | None]] | None = None,
) -> str:
    """Parse a CAS PDF and persist holdings + daily ledger to the DB.

    Uses db.persist.persist (the shared write path) per (platform, account_ref)
    batch with is_eod=True at the statement end date, so CAS rows land in
    `position` (live state), `position_snapshot` (monthly ledger), and
    `price_history` (statement NAV) exactly like a broker EOD run.

    `sectors` defaults to the same curated data/sectors.csv the live legs use
    (ISIN-keyed for MFs) so the pipeline path never needs an explicit map;
    pass {} to opt out.

    The legacy portfolio_value write path is gone entirely (F1) - per-batch
    writes clobbered the UNIQUE(value_date, is_eod, scope_type, scope_key) slot
    (last batch wins; M-3 live proof: 06-30 `all` == the groww batch only). The
    dashboard's value series is derived from position_snapshot at export time
    (portfolio.series), so no portfolio_value rows are written anywhere.
    """
    from portfolio.db.migrate import migrate
    from portfolio.db.persist import persist
    from portfolio.mf_nav import NAVError, get_nav_names

    migrate(db_path)  # idempotent - `cas import` must work on a fresh DB
    raw = read_cas(pdf_path, password)
    snapshot_date = statement_end_date(raw)

    nav_names: Mapping[str, str] = {}
    if enrich_names:
        try:
            nav_names = get_nav_names()
        except NAVError as exc:  # names are best-effort; the import proceeds
            logger.warning("AMFI name enrichment unavailable: %s", exc)

    holdings_groups, stats = extract_holdings(raw, nav_names=nav_names, sectors=sectors or load_sectors())
    if not holdings_groups:
        raise ValueError("CAS yielded no importable holdings")

    base = Settings().base_currency
    base_now = datetime.now(UTC)

    db = connect(db_path)
    try:
        for i, ((platform, account_ref), group) in enumerate(holdings_groups.items()):
            # runs is UNIQUE(platform, started_at) - the same platform can have
            # several CAS batches (groww demat + groww folio), so each batch
            # gets its own started_at (now + i seconds).
            run_at = (base_now.replace(microsecond=0) + timedelta(seconds=i)).isoformat()
            run_id = writer.write_run(db, platform, snapshot_date, run_at, "running", is_eod=True)
            try:
                persist(
                    db, run_id, run_at, group, snapshot_date, base,
                    is_eod=True, account_ref=account_ref,
                )
            except Exception as exc:  # noqa: BLE001 - audit the failure, keep going
                writer.update_run(db, run_id, "error", 0, error=str(exc))
                logger.error("cas batch %s/%s failed: %s", platform, account_ref, exc)
                raise
            writer.update_run(db, run_id, "ok", len(group))
    finally:
        db.close()

    parts = [f"statement={snapshot_date}"]
    for platform, n in sorted(stats["by_platform"].items()):
        parts.append(f"{platform}={n}")
    parts.append(f"returns_ok={stats['cost_known']}")
    parts.append(f"value_only={stats['cost_missing']}")
    if stats["skipped_zerodha_equities"]:
        parts.append(f"zerodha_equities_skipped={stats['skipped_zerodha_equities']} (live MCP)")
    return " | ".join(parts)
