"""CAS import: normalizer + e2e import against the scrubbed June 2026 fixture."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from portfolio.cas_import import (
    extract_holdings,
    import_cas,
    statement_end_date,
)
from portfolio.db.migrate import migrate
from portfolio.normalize.sectors import load_sectors

FIXTURE = Path(__file__).parent.parent / "samples" / "cas" / "cas_june2026_scrubbed.json"
CAS_PDF = Path(__file__).parent.parent / "data" / "cas" / "CAS-June2026.pdf"


def _fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_statement_end_date():
    assert statement_end_date(_fixture()) == "2026-06-30"


def test_extract_holdings_groups_and_stats():
    groups, stats = extract_holdings(_fixture())
    assert stats["skipped_zerodha_equities"] == 34  # live MCP covers zerodha stocks
    assert stats["cost_known"] == 7  # the folio MFs carry total_cost
    assert stats["cost_missing"] == 20  # demat MFs + equities: value only

    keys = set(groups)
    assert ("sharekhan", "8462XXXXX") in keys or any(k[0] == "sharekhan" for k in keys)
    assert any(k == ("groww", "folio") for k in keys)
    assert any(k[0] == "groww" and k[1] != "folio" for k in keys)
    assert any(k[0] == "zerodha" for k in keys)  # only its MF is imported

    total = sum(len(v) for v in groups.values())
    assert total == 27


def test_extract_holdings_field_mapping():
    groups, _ = extract_holdings(_fixture())
    folio = next(v for (p, r), v in groups.items() if r == "folio")
    demat = next(v for (p, r), v in groups.items() if p == "groww" and r != "folio")
    sharekhan = next(v for (p, r), v in groups.items() if p == "sharekhan")

    # Folio MF: full cost basis -> returns computable.
    axis = next(h for h in folio if h.ticker == "INF846K01K35")
    assert axis.asset_class == "mutual_fund"
    assert axis.quantity == pytest.approx(1914.344)
    assert axis.cost_basis == pytest.approx(188700.00)
    assert axis.avg_price == pytest.approx(98.5716)
    assert axis.current_value == pytest.approx(250913.07)
    assert axis.currency == "INR" and axis.geography == "IN"

    # Demat MF: value only (CAS carries no cost basis).
    axis_demat = next(h for h in demat if h.ticker == "INF846K01K35")
    assert axis_demat.cost_basis is None
    assert axis_demat.avg_price is None
    assert axis_demat.current_value is not None

    # Sharekhan equity: ticker from the ISIN-DB symbol, name cleaned of '#...'.
    bfin = next(h for h in sharekhan if h.ticker == "BAJFINANCE")
    assert bfin.asset_class == "equity"
    assert bfin.quantity == pytest.approx(10)
    assert bfin.current_price == pytest.approx(1004.75)
    assert bfin.cost_basis is None
    assert "#" not in (bfin.name or "")


def test_extract_holdings_curated_sectors():
    """CAS rows take sector/asset_class from the curated map — ISIN-keyed for
    MFs (the demat-MF ticker IS the ISIN), symbol-keyed for equities. Guards
    the ISIN data-shape contract end to end (fixture + real sectors.csv)."""
    groups, _ = extract_holdings(_fixture(), sectors=load_sectors())
    folio = next(v for (p, r), v in groups.items() if r == "folio")
    demat = next(v for (p, r), v in groups.items() if p == "groww" and r != "folio")
    sharekhan = next(v for (p, r), v in groups.items() if p == "sharekhan")

    # (a) ISIN-keyed MF rows get their AMFI/Groww fund category.
    ppfas = next(h for h in folio if h.ticker == "INF879O01027")
    assert ppfas.sector == "Flexi Cap"
    assert ppfas.asset_class == "mutual_fund"
    gold = next(h for h in demat if h.ticker == "INF204KB17I5")
    assert gold.sector == "Gold"
    assert gold.asset_class == "etf"  # CSV wins over the name-derived guess

    # (b) Sharekhan equities get their sector by symbol.
    assert next(h for h in sharekhan if h.ticker == "BAJFINANCE").sector == "Financial Services"
    assert next(h for h in sharekhan if h.ticker == "RELAXO").sector == "Consumer"

    # (c) Keying is exact: an ISIN map never leaks onto an equity row (or vice
    # versa) — a row absent from the map keeps sector None, never "unknown".
    hand = {"INF879O01027": ("Flexi Cap", "mutual_fund"), "RELAXO": ("Consumer", "equity")}
    groups2, _ = extract_holdings(_fixture(), sectors=hand)
    demat2 = next(v for (p, r), v in groups2.items() if p == "groww" and r != "folio")
    sharekhan2 = next(v for (p, r), v in groups2.items() if p == "sharekhan")
    assert next(h for h in demat2 if h.ticker == "INF846K01K35").sector is None
    assert next(h for h in sharekhan2 if h.ticker == "BAJFINANCE").sector is None
    assert next(h for h in demat2 if h.ticker == "INF879O01027").sector == "Flexi Cap"


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


def test_import_cas_e2e(db, monkeypatch):
    if not CAS_PDF.exists():
        pytest.skip("real CAS PDF not present (data/cas/ is gitignored)")
    monkeypatch.setattr("portfolio.mf_nav.get_nav_names", lambda fetch=None: {})
    monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db))

    result = import_cas(CAS_PDF, db_path=db)
    assert "statement=2026-06-30" in result
    assert "returns_ok=7" in result
    assert "value_only=20" in result
    assert "zerodha_equities_skipped=34" in result

    from portfolio.db import connect

    conn = connect(db)
    assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 27
    assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 27
    runs = conn.execute("SELECT platform, status, rows FROM runs").fetchall()
    assert len(runs) == 4
    assert all(r["status"] == "ok" for r in runs)
    # folio MFs persist their cost basis
    row = conn.execute(
        "SELECT p.cost_value_ccy, p.market_value_ccy FROM position p"
        " JOIN account a ON a.id=p.account_id JOIN instrument i ON i.id=p.instrument_id"
        " WHERE a.account_ref='folio' AND i.ticker='INF846K01K35'"
    ).fetchone()
    assert row["cost_value_ccy"] == pytest.approx(188700.00)
    conn.close()
