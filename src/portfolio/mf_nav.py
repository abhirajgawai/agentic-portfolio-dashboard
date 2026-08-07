"""AMFI NAV table: one fetch per run, keyless official data (MF leg).

Why this exists (research, 2026-08-07): the user's mutual funds live on the
Groww platform, but Groww's official Trade API (growwapi SDK) has NO mutual
fund endpoints - verified by grepping the entire SDK for mf/mutual/fund/nav
(zero hits) and by the docs' nav (no MF section; stocks/F&O/commodity only).
So MFs cannot come through the broker API. Instead:

  * units + invested amount  -> data/mf_holdings.csv (user-maintained, from
    the Groww app / AMFI CAS statement) - the manual step, like daily logins.
  * NAV (current price)       -> this module: the OFFICIAL AMFI NAVAll.txt
    (https://www.amfiindia.com/spages/NAVAll.txt), free, keyless, updated
    daily. Same "one fetch per run" contract as fx.py: the whole table comes
    in one HTTP call and is cached process-wide so every holding resolves its
    NAV against the SAME snapshot of the feed (determinism).

File format (semicolon-delimited, verified 2026-08-07):
    Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
    119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla ... IDCW;107.0834;06-Aug-2026
Section headers ("Open Ended Schemes(...)") and AMC names are non-data lines.
We index by BOTH ISIN columns (growth + IDCW-reinvestment) so the manifest's
ISIN resolves regardless of the option held.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from portfolio.config import DB_PATH

logger = logging.getLogger("portfolio.mf_nav")

AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
_FIELDS = 6

# Asia/Kolkata is the ledger's market-date timezone (NIT-2 convention).
_IST = ZoneInfo("Asia/Kolkata")

# Process-wide cache: one fetch per run == every holding sees the same NAV day.
_NAV_CACHE: dict[str, tuple[float, str]] = {}
_NAME_CACHE: dict[str, str] = {}
_NAV_DATE: str | None = None

# Overridable in tests to serve the pinned fixture without network.
FetchFn = Callable[[], str]


class NAVError(Exception):
    """A run cannot price its MF holdings because AMFI NAV is unavailable."""


def _parse_nav_date(value: str) -> str:
    """'06-Aug-2026' -> '2026-08-06'; unparseable values pass through unchanged."""
    text = value.strip()
    try:
        return datetime.strptime(text, "%d-%b-%Y").date().isoformat()
    except ValueError:
        return text


def parse_nav_table(text: str) -> tuple[dict[str, tuple[float, str]], str | None, dict[str, str]]:
    """Parse NAVAll.txt into {isin: (nav, date)} + the file's last NAV date +
    {isin: scheme name}. Deterministic: identical input -> identical output.
    Non-data lines (section headers, AMC names, the header row) are skipped by
    requiring exactly 6 fields with a numeric NAV. Both ISIN columns are
    indexed; scheme name comes from the row's Scheme Name column.
    """
    table: dict[str, tuple[float, str]] = {}
    names: dict[str, str] = {}
    last_date: str | None = None
    for line in text.splitlines():
        parts = line.split(";")
        if len(parts) != _FIELDS:
            continue
        _, isin_growth, isin_reinv, name, nav_raw, date_raw = parts
        nav = _to_float(nav_raw)
        if nav is None:
            continue  # header row or garbage
        date = _parse_nav_date(date_raw)
        # The file is grouped by scheme with varying NAV dates; the "feed
        # date" is the NEWEST date seen, not the last row's.
        if date and (last_date is None or date > last_date):
            last_date = date
        scheme_name = name.strip()
        for isin in (isin_growth.strip(), isin_reinv.strip()):
            if isin and isin != "-":
                table[isin] = (nav, date)
                if scheme_name and isin not in names:
                    names[isin] = scheme_name
    return table, last_date, names


def _to_float(value: Any) -> float | None:
    try:
        # Un-audited NAVs carry a '=' prefix in NAVAll.txt (e.g. "=116.00");
        # the value is still the NAV, so strip the marker before parsing.
        return float(str(value).strip().lstrip("=").strip())
    except (TypeError, ValueError):
        return None


def _fetch_nav_table_text() -> str:
    """Fetch the AMFI NAVAll.txt (the whole table in ONE HTTP call)."""
    try:
        # AMFI 302-redirects www.amfiindia.com -> portal.amfiindia.com (observed
        # 2026-08-07); httpx does not follow redirects by default, so this must
        # be explicit or every fetch fails on the redirect hop.
        resp = httpx.get(AMFI_NAV_URL, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise NAVError(f"AMFI NAV fetch failed: {exc}") from exc
    return resp.content.decode("utf-8-sig", errors="replace")


def get_nav_table(*, fetch: FetchFn | None = None) -> Mapping[str, tuple[float, str]]:
    """Return {isin: (nav, date)} for the run - at most ONE fetch per process.

    `fetch` is injectable for tests (defaults to the real AMFI call). Raises
    NAVError when the feed cannot be fetched or yields no usable rows: a run
    that cannot price its MFs must fail loudly, not guess.
    """
    global _NAV_DATE
    if not _NAV_CACHE:
        fetcher = fetch or _fetch_nav_table_text
        table, last_date, names = parse_nav_table(fetcher())
        if not table:
            raise NAVError("AMFI NAV feed yielded no parseable rows")
        _NAV_CACHE.update(table)
        _NAME_CACHE.update(names)
        _NAV_DATE = last_date
        logger.info("fetched AMFI NAV table (%d schemes, nav date %s)", len(table), last_date)
    return _NAV_CACHE


def get_nav_names(*, fetch: FetchFn | None = None) -> Mapping[str, str]:
    """{isin: scheme name} from the same feed (best-effort display enrichment).

    Calls get_nav_table first so the process-wide one-fetch-per-run rule holds:
    the names ride along the same fetch that populated the NAV table.
    """
    get_nav_table(fetch=fetch)
    return _NAME_CACHE


def get_nav(isin: str, *, fetch: FetchFn | None = None) -> tuple[float, str] | None:
    """NAV + date for one ISIN, or None when the feed does not know it."""
    return get_nav_table(fetch=fetch).get(isin)


def reset_nav_cache() -> None:
    """Clear the process-wide cache (tests only)."""
    _NAV_CACHE.clear()
    _NAME_CACHE.clear()
    global _NAV_DATE
    _NAV_DATE = None


# ---------------------------------------------------------------------------
# Daily price refresh (M-1): AMFI NAVAll.txt -> position / price_history /
# position_snapshot. This is what makes the "MF prices refresh daily" claim
# true - without it, CAS MFs sit at the statement-date NAV for a month.
# ---------------------------------------------------------------------------


def refresh_nav_prices(
    db_path: str | Path = DB_PATH,
    *,
    today: str | None = None,
    fetch: FetchFn | None = None,
) -> str:
    """Refresh every CAS-derived MF + ETF position's price from the AMFI feed.

    SCOPE (explicit SQL WHERE, not a Python filter): positions whose account is
    CAS-derived - platform IN ('groww','sharekhan') OR (platform='zerodha' AND
    account_ref != '') - AND asset_class IN ('mutual_fund','etf'). Indian ETFs
    ARE open-ended schemes with daily NAVs in NAVAll.txt (verified live for all
    CAS ETF ISINs), so they refresh like MFs. Live-leg positions (zerodha
    account_ref='', moomoo) are NEVER selected - they are fresh via their broker
    legs and must not be counted or touched.

    One AMFI fetch per run (the process-wide get_nav_table cache), so every
    holding resolves against the SAME snapshot of the feed (determinism).
    NAVs are INR, so rate = 1 and market_value_ccy == market_value_base ==
    quantity * nav; cost fields are NEVER touched (returns stay computable).

    Per priced position this writes:
      position.price / market_value_ccy / market_value_base  (in place; cost
        fields untouched, updated_at bumped so M-4 freshness follows)
      price_history   (instrument_id, price_date, nav, 'INR')  UNIQUE -> idempotent
      position_snapshot (price_date, account, instrument)      UNIQUE -> idempotent
    where price_date = min(NAV's own date from the feed, today) (F2).
    plus one `runs` row (platform='amfi', status ok/error, rows=refreshed).

    Counting: refreshed = priced CAS MF/ETF positions; not_in_amfi = CAS
    positions the feed does not cover (the never-priced CAS equities, e.g. the
    Sharekhan stocks, plus any MF/ETF whose ISIN is absent). Live legs are not
    counted at all.

    Returns a summary string ("refreshed=N | not_in_amfi=K").
    """
    from portfolio.db import connect, writer
    from portfolio.db.migrate import migrate

    migrate(db_path)  # fresh-DB safety, same as cas_import
    today = today or datetime.now(_IST).date().isoformat()
    run_at = datetime.now(UTC).isoformat()
    db = connect(db_path)
    run_id: int | None = None
    try:
        get_nav_table(fetch=fetch)  # exactly one AMFI fetch per run
        run_id = writer.write_run(db, "amfi", today, run_at, "running", is_eod=False)

        # Pricing scope: CAS-derived accounts, MF + ETF only (live legs excluded
        # by construction - the account join + platform/account_ref predicate).
        positions = db.execute(
            """
            SELECT p.account_id, p.instrument_id, p.quantity, p.avg_cost,
                   p.cost_value_ccy, p.cost_value_base, i.isin, i.ticker,
                   i.asset_class
            FROM position p
            JOIN account a ON a.id = p.account_id
            JOIN instrument i ON i.id = p.instrument_id
            WHERE i.asset_class IN ('mutual_fund', 'etf')
              AND (a.platform IN ('groww', 'sharekhan')
                   OR (a.platform = 'zerodha' AND a.account_ref != ''))
            ORDER BY i.ticker
            """
        ).fetchall()
        total_cas = db.execute(
            """
            SELECT COUNT(*) FROM position p
            JOIN account a ON a.id = p.account_id
            WHERE a.platform IN ('groww', 'sharekhan')
               OR (a.platform = 'zerodha' AND a.account_ref != '')
            """
        ).fetchone()[0]

        refreshed = 0
        not_in_feed: list[str] = []
        for row in positions:
            # CAS MFs/ETFs store the ISIN IN the ticker column (the normalizer
            # sets ticker=isin and never populates instrument.isin) - so the NAV
            # lookup key is `isin or ticker`, never isin alone.
            lookup_isin = row["isin"] or row["ticker"]
            hit = get_nav(lookup_isin, fetch=fetch)  # cache: no extra fetch
            if hit is None:
                not_in_feed.append(row["ticker"])
                continue
            nav, nav_date = hit
            # F2: the ledger rows are dated with the NAV's OWN date (the AMFI
            # feed reports a per-scheme NAV date, e.g. 06-Aug-2026), capped at
            # `today` so a late-day run never writes a future date. UNIQUE keys
            # make same-day coexistence automatic - a run on 08-07 whose feed
            # still says 08-06 simply upserts the 08-06 ledger rows.
            price_date = min(nav_date, today) if nav_date else today
            quantity = row["quantity"] or 0.0
            market_value = quantity * nav
            writer.upsert_position(
                db, row["account_id"], row["instrument_id"],
                quantity=row["quantity"], avg_cost=row["avg_cost"], price=nav,
                cost_value_ccy=row["cost_value_ccy"], market_value_ccy=market_value,
                market_value_base=market_value, cost_value_base=row["cost_value_base"],
                updated_at=run_at,
            )
            writer.upsert_price(db, row["instrument_id"], price_date, nav, "INR")
            writer.upsert_position_snapshot(
                db, run_id, row["account_id"], row["instrument_id"], None, price_date,
                quantity=row["quantity"], avg_cost=row["avg_cost"], price=nav,
                cost_value_ccy=row["cost_value_ccy"], market_value_ccy=market_value,
                market_value_base=market_value, cost_value_base=row["cost_value_base"],
            )
            refreshed += 1

        writer.update_run(db, run_id, "ok", refreshed)
        # Every CAS position is either refreshed (feed covers it) or counted as
        # not_in_amfi (CAS equities have no AMFI NAV; MF/ETF ISINs absent here).
        not_in_amfi = total_cas - refreshed
        if not_in_feed:
            logger.warning(
                "CAS MF/ETF ISINs not in AMFI feed (left at last price): %s",
                ", ".join(sorted(not_in_feed)),
            )
        return f"refreshed={refreshed} | not_in_amfi={not_in_amfi}"
    except Exception as exc:  # noqa: BLE001 - audit, never crash un-audited
        error = str(exc)
        if run_id is not None:
            writer.update_run(db, run_id, "error", 0, error=error)
        else:
            writer.write_run(db, "amfi", today, run_at, "error", error=error)
        raise NAVError(f"nav refresh failed: {error}") from exc
    finally:
        db.close()
