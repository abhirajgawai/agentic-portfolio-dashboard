"""M-3 regression: the value series is DERIVED from position_snapshot, never
written incrementally.

The old design wrote portfolio_value rows per leg into a UNIQUE(value_date,
is_eod, scope_type, scope_key) slot - the last writer won, so `all` silently
excluded other legs (live proof: 2026-06-30 `all` == the groww batch only).
These tests pin the derived `portfolio.series.portfolio_series` contract and
the cas_import behavior that no longer writes portfolio_value at all.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from portfolio.cas_import import import_cas
from portfolio.db import connect, writer
from portfolio.db.migrate import migrate
from portfolio.series import portfolio_series

CAS_FIXTURE = Path(__file__).parent.parent / "samples" / "cas" / "cas_june2026_scrubbed.json"


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "t.db"
    migrate(path)
    return path


def _seed(conn) -> None:
    """Mixed-frequency legs: 3 platforms on date A, 2 (different) on date B.

    Date A (2026-08-06): zerodha 100, groww 200, moomoo 300  -> all = 600
    Date B (2026-08-07): sharekhan 50, moomoo 250; zerodha and groww are
    absent, so their Date A values carry forward -> all = 600.
    """
    spec = [
        ("2026-08-06", "zerodha", "IN", "", 100.0),
        ("2026-08-06", "groww", "IN", "", 200.0),
        ("2026-08-06", "moomoo", "US", "ACC-1", 300.0),
        ("2026-08-07", "sharekhan", "IN", "", 50.0),
        ("2026-08-07", "moomoo", "US", "ACC-1", 250.0),
    ]
    for i, (day, platform, geo, acc_ref, value) in enumerate(spec):
        run_id = writer.write_run(
            conn, platform, day, f"run-{i}-{platform}", "ok", rows=1, is_eod=True
        )
        acc = writer.ensure_account(
            conn, platform, account_ref=acc_ref,
            base_currency="INR" if geo == "IN" else "SGD",
        )
        inst = writer.ensure_instrument(
            conn, platform, f"{platform.upper()}-{i}",
            currency="INR" if geo == "IN" else "USD", geography=geo,
        )
        writer.upsert_position_snapshot(
            conn, run_id, acc, inst, None, day,
            quantity=1.0, avg_cost=value, price=value,
            cost_value_ccy=value, market_value_ccy=value, market_value_base=value,
            cost_value_base=value,
        )


def test_series_mixed_frequency_dates_are_honest(db) -> None:
    conn = connect(db)
    try:
        _seed(conn)
        series = portfolio_series(conn, "INR")
    finally:
        conn.close()

    assert series["dates"] == ["2026-08-06", "2026-08-07"]
    assert series["portfolioValueBase"] == [600.0, 600.0]
    # Date B carries zerodha 100 and groww 200; it does not treat their
    # missing snapshots as zero.
    assert series["byGeography"] == {"IN": [300.0, 350.0], "US": [300.0, 250.0]}
    # Platform-complete by construction (M8.x fresh-start reset regression):
    # real_estate is in the platform registry but has no rows in this seed,
    # so it appears zero-filled rather than vanishing from the dict entirely.
    assert series["byPlatform"] == {
        "groww": [200.0, 200.0],
        "moomoo": [300.0, 250.0],
        "real_estate": [0.0, 0.0],
        "sharekhan": [0.0, 50.0],
        "zerodha": [100.0, 100.0],
    }
    # Per-date invariant: all == sum(platform) == sum(geography).
    for i in range(len(series["dates"])):
        assert series["portfolioValueBase"][i] == pytest.approx(
            sum(p[i] for p in series["byPlatform"].values())
        )
        assert series["portfolioValueBase"][i] == pytest.approx(
            sum(g[i] for g in series["byGeography"].values())
        )


def test_series_carries_complete_multi_instrument_platform_snapshot(db) -> None:
    """A missing platform date carries its complete prior instrument aggregate."""
    conn = connect(db)
    try:
        # Zerodha's first snapshot is complete: both instruments belong to the
        # platform and must be carried together when Zerodha is absent later.
        for i, value in enumerate((100.0, 250.0)):
            run_id = writer.write_run(
                conn, "zerodha", "2026-08-06", f"run-zerodha-{i}", "ok",
                rows=2, is_eod=True,
            )
            account = writer.ensure_account(conn, "zerodha", account_ref="")
            instrument = writer.ensure_instrument(
                conn, "zerodha", f"ZERODHA-{i}", currency="INR", geography="IN",
            )
            writer.upsert_position_snapshot(
                conn, run_id, account, instrument, None, "2026-08-06",
                quantity=1.0, avg_cost=value, price=value,
                cost_value_ccy=value, market_value_ccy=value,
                market_value_base=value, cost_value_base=value,
            )

        run_id = writer.write_run(
            conn, "moomoo", "2026-08-07", "run-moomoo", "ok", rows=1, is_eod=True,
        )
        account = writer.ensure_account(conn, "moomoo", account_ref="ACC-1", base_currency="SGD")
        instrument = writer.ensure_instrument(
            conn, "moomoo", "MOOMOO-0", currency="USD", geography="US",
        )
        writer.upsert_position_snapshot(
            conn, run_id, account, instrument, None, "2026-08-07",
            quantity=1.0, avg_cost=75.0, price=75.0,
            cost_value_ccy=75.0, market_value_ccy=75.0,
            market_value_base=75.0, cost_value_base=75.0,
        )
        series = portfolio_series(conn, "INR")
    finally:
        conn.close()

    assert series["dates"] == ["2026-08-06", "2026-08-07"]
    assert series["byPlatform"]["zerodha"] == [350.0, 350.0]
    # Platform-complete by construction: groww/sharekhan/real_estate are in
    # the registry but have no rows in this seed - zero-filled, not absent.
    for zero_platform in ("groww", "sharekhan", "real_estate"):
        assert series["byPlatform"][zero_platform] == [0.0, 0.0]
    assert series["portfolioValueBase"] == [350.0, 425.0]
    assert series["byGeography"] == {"IN": [350.0, 350.0], "US": [0.0, 75.0]}
    for i in range(len(series["dates"])):
        assert series["portfolioValueBase"][i] == pytest.approx(
            sum(p[i] for p in series["byPlatform"].values())
        )
        assert series["portfolioValueBase"][i] == pytest.approx(
            sum(g[i] for g in series["byGeography"].values())
        )


def test_series_by_account_splits_multi_account_platforms(db) -> None:
    """M-5: a platform with multiple independently-tracked accounts (e.g.
    groww's automated CAS folio import vs. its hand-entered manual equities
    total) must be chartable as separate lines, not just their summed
    byPlatform total - that summed-only view is what made the two legs
    indistinguishable in every chart before byAccount existed."""
    conn = connect(db)
    try:
        # groww:folio only on day 1, groww:manual on both days (day 2 has a
        # fresh manual entry) - exercises independent per-account carry-forward.
        spec = [
            ("2026-08-06", "groww", "folio", 500.0),
            ("2026-08-06", "groww", "manual", 100.0),
            ("2026-08-07", "groww", "manual", 120.0),
            ("2026-08-06", "zerodha", "", 50.0),  # single-account platform
        ]
        for i, (day, platform, acc_ref, value) in enumerate(spec):
            run_id = writer.write_run(
                conn, platform, day, f"run-{i}-{platform}-{acc_ref}", "ok", rows=1, is_eod=True
            )
            acc = writer.ensure_account(conn, platform, account_ref=acc_ref)
            inst = writer.ensure_instrument(
                conn, platform, f"{platform.upper()}-{acc_ref or 'X'}-{i}",
                currency="INR", geography="IN",
            )
            writer.upsert_position_snapshot(
                conn, run_id, acc, inst, None, day,
                quantity=1.0, avg_cost=value, price=value,
                cost_value_ccy=value, market_value_ccy=value, market_value_base=value,
                cost_value_base=value,
            )
        series = portfolio_series(conn, "INR")
    finally:
        conn.close()

    assert series["dates"] == ["2026-08-06", "2026-08-07"]
    # folio carries its day-1 value forward on day 2 (no new folio row that day).
    assert series["byAccount"]["groww:folio"] == [500.0, 500.0]
    assert series["byAccount"]["groww:manual"] == [100.0, 120.0]
    # byPlatform is still the sum of both accounts, unchanged by this feature.
    assert series["byPlatform"]["groww"] == [600.0, 620.0]
    # A single-account platform (empty account_ref) is NOT duplicated into
    # byAccount under a "zerodha:" key - byPlatform.zerodha already IS it.
    assert "zerodha:" not in series["byAccount"]
    assert not any(key.startswith("zerodha:") for key in series["byAccount"])


def test_series_deterministic_sorted_keys(db) -> None:
    conn = connect(db)
    try:
        _seed(conn)
        first = portfolio_series(conn, "INR")
        second = portfolio_series(conn, "INR")
    finally:
        conn.close()
    assert first == second  # identical input -> identical output
    assert list(first["byPlatform"]) == sorted(first["byPlatform"])
    assert list(first["byGeography"]) == sorted(first["byGeography"])


def test_cas_import_writes_no_portfolio_value_rows(db, monkeypatch) -> None:
    """M-3/F1 regression: cas_import writes NO portfolio_value rows - the write
    path is gone entirely (there is no write_values flag to pass any more).

    Per-batch portfolio_value writes clobber the UNIQUE(value_date, is_eod,
    scope_type, scope_key) slot (last batch wins) - the exact live-DB bug.
    """
    fixture = json.loads(CAS_FIXTURE.read_text(encoding="utf-8"))
    monkeypatch.setattr("portfolio.cas_import.read_cas", lambda pdf, password="": fixture)
    monkeypatch.setattr("portfolio.mf_nav.get_nav_names", lambda fetch=None: {})

    result = import_cas("dummy.pdf", db_path=db)
    assert "statement=2026-06-30" in result  # the real fixture still imports

    conn = connect(db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM portfolio_value").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM position").fetchone()[0] == 27
        assert conn.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0] == 27
    finally:
        conn.close()
