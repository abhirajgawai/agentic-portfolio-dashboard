"""Market calendar tests (M4): pure, deterministic, DST-safe scheduling gate.

Fixtures live in pytest's tmp_path (NEVER data/holidays): two small JSON files
with KNOWN dates — NSE Republic Day (Mon 2026-01-26) and NYSE's observed
Independence Day (Fri 2026-07-03, because Jul 4 2026 is a Saturday) — plus a
couple more to exercise weekends and precedence.

DST note: the task's literal boundary dates (2026-03-08 / 2026-11-01) are
SUNDAYS (US DST transitions legally happen at 2 AM on the second Sunday of
March / first Sunday of November), so `market_open` is False by the weekday
rule. The offset math is proven on the following MONDAYS (03-09 / 11-02), and
the Sundays themselves assert the weekend rule wins at the boundary.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from portfolio.calendars import (
    gate_check,
    is_trading_day,
    market_open,
    reason_closed,
    reset_calendar_cache,
)

IST = ZoneInfo("Asia/Kolkata")
ET = ZoneInfo("America/New_York")


@pytest.fixture(autouse=True)
def _clean_cache():
    reset_calendar_cache()
    yield
    reset_calendar_cache()


def at(tz: ZoneInfo, y: int, m: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, m, d, h, mi, tzinfo=tz)


@pytest.fixture()
def holidays_dir(tmp_path: Path) -> Path:
    (tmp_path / "nse_2026.json").write_text(
        json.dumps(
            {
                "exchange": "NSE",
                "year": 2026,
                "source": "test fixture",
                "holidays": [
                    {"date": "2026-01-26", "name": "Republic Day"},
                    {"date": "2026-03-03", "name": "Holi"},
                    # A gazetted holiday that lands on a Saturday: the weekend
                    # rule must win (the market is closed because it IS a
                    # Saturday, not because of the holiday).
                    {"date": "2026-08-15", "name": "Independence Day"},
                ],
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "nyse_2026.json").write_text(
        json.dumps(
            {
                "exchange": "NYSE",
                "year": 2026,
                "source": "test fixture",
                "holidays": [
                    {"date": "2026-07-03", "name": "Independence Day (observed)"},
                    {"date": "2026-11-26", "name": "Thanksgiving"},
                ],
            }
        ),
        encoding="utf-8",
    )
    return tmp_path


def test_weekend_skip(holidays_dir):
    sat = at(IST, 2026, 8, 8, 10, 0)  # Saturday
    assert not is_trading_day("IN", sat, holidays_dir=holidays_dir)
    assert not market_open("IN", sat, holidays_dir=holidays_dir)
    assert reason_closed("IN", sat, holidays_dir=holidays_dir) == "weekend"
    assert gate_check("IN", sat, is_eod=False, holidays_dir=holidays_dir) == "weekend"
    assert gate_check("IN", sat, is_eod=True, holidays_dir=holidays_dir) == "weekend"


def test_holiday_skip(holidays_dir):
    mon = at(IST, 2026, 1, 26, 10, 0)  # Republic Day, a Monday
    assert not is_trading_day("IN", mon, holidays_dir=holidays_dir)
    assert not market_open("IN", mon, holidays_dir=holidays_dir)
    assert reason_closed("IN", mon, holidays_dir=holidays_dir) == "holiday: Republic Day"
    assert gate_check("IN", mon, is_eod=False, holidays_dir=holidays_dir) == "holiday: Republic Day"
    assert gate_check("IN", mon, is_eod=True, holidays_dir=holidays_dir) == "holiday: Republic Day"


def test_nyse_observed_holiday(holidays_dir):
    fri = at(ET, 2026, 7, 3, 10, 0)  # observed Independence Day (Jul 4 is a Sat)
    assert not is_trading_day("US", fri, holidays_dir=holidays_dir)
    assert reason_closed("US", fri, holidays_dir=holidays_dir) == "holiday: Independence Day (observed)"


def test_open_windows(holidays_dir):
    assert market_open("IN", at(IST, 2026, 8, 6, 10, 0), holidays_dir=holidays_dir)
    assert market_open("US", at(ET, 2026, 8, 6, 10, 0), holidays_dir=holidays_dir)
    assert reason_closed("IN", at(IST, 2026, 8, 6, 10, 0), holidays_dir=holidays_dir) is None


def test_boundary_inclusive_open_exclusive_close(holidays_dir):
    # NSE: 09:15 open (inclusive), 15:30 close (exclusive).
    assert market_open("IN", at(IST, 2026, 8, 6, 9, 15), holidays_dir=holidays_dir)
    assert not market_open("IN", at(IST, 2026, 8, 6, 15, 30), holidays_dir=holidays_dir)
    # NYSE: 09:30 open (inclusive), 16:00 close (exclusive).
    assert market_open("US", at(ET, 2026, 8, 6, 9, 30), holidays_dir=holidays_dir)
    assert not market_open("US", at(ET, 2026, 8, 6, 16, 0), holidays_dir=holidays_dir)


def test_before_open_and_after_close(holidays_dir):
    assert (
        reason_closed("IN", at(IST, 2026, 8, 6, 9, 0), holidays_dir=holidays_dir)
        == "before open (09:15 IST)"
    )
    assert (
        reason_closed("IN", at(IST, 2026, 8, 6, 16, 0), holidays_dir=holidays_dir)
        == "after close (15:30 IST)"
    )
    assert (
        reason_closed("US", at(ET, 2026, 8, 6, 16, 30), holidays_dir=holidays_dir)
        == "after close (16:00 EDT)"  # summer -> DST-aware label
    )


def test_gate_check_policy(holidays_dir):
    # EOD allowed at ANY time on a trading day — even 23:00 IST or 08:00 IST.
    assert gate_check("IN", at(IST, 2026, 8, 6, 23, 0), is_eod=True, holidays_dir=holidays_dir) is None
    assert gate_check("IN", at(IST, 2026, 8, 6, 8, 0), is_eod=True, holidays_dir=holidays_dir) is None
    # Live poll after close -> blocked; at 10:00 IST -> allowed.
    assert (
        gate_check("IN", at(IST, 2026, 8, 6, 18, 0), is_eod=False, holidays_dir=holidays_dir)
        == "after close (15:30 IST)"
    )
    assert gate_check("IN", at(IST, 2026, 8, 6, 10, 0), is_eod=False, holidays_dir=holidays_dir) is None


def test_us_dst_boundary(holidays_dir):
    # Spring forward, first trading day after the change: 2026-03-09 (Mon),
    # DST in effect -> 13:30 UTC == 09:30 EDT -> open. A hardcoded UTC-5 would
    # read 08:30 (before open); only a real tz database gets this right.
    assert market_open("US", at(UTC, 2026, 3, 9, 13, 30), holidays_dir=holidays_dir)
    # Fall back: 2026-11-02 (Mon), DST over -> 14:30 UTC == 09:30 EST -> open.
    # A hardcoded UTC-4 would read 10:30 (also open, but the LABEL would lie);
    # the EST assertion below pins the actual offset.
    assert market_open("US", at(UTC, 2026, 11, 2, 14, 30), holidays_dir=holidays_dir)
    # The literal DST-transition days (2026-03-08 / 2026-11-01) are SUNDAYS:
    # the weekend rule wins at the boundary, and the UTC->local math is exactly
    # what the task asks to prove (09:30 EDT / 09:30 EST, no hardcoded offset).
    assert reason_closed("US", at(UTC, 2026, 3, 8, 13, 30), holidays_dir=holidays_dir) == "weekend"
    assert reason_closed("US", at(UTC, 2026, 11, 1, 14, 30), holidays_dir=holidays_dir) == "weekend"
    # DST-aware label flips: summer says EDT, winter says EST.
    assert (
        reason_closed("US", at(ET, 2026, 12, 1, 16, 30), holidays_dir=holidays_dir)
        == "after close (16:00 EST)"
    )


def test_unknown_geography_raises():
    with pytest.raises(ValueError, match="unknown geography"):
        is_trading_day("XX", at(IST, 2026, 8, 6, 10, 0))


def test_naive_datetime_raises(holidays_dir):
    # A naive datetime has no offset; astimezone would guess the MACHINE zone
    # and break the determinism contract — the module must refuse it.
    with pytest.raises(ValueError, match="timezone-aware"):
        is_trading_day("IN", datetime(2026, 8, 6, 10, 0), holidays_dir=holidays_dir)


def test_missing_holiday_file_warns_and_degrades(tmp_path, caplog):
    # No JSON files at all in this dir -> weekday-only gate + a warning.
    with caplog.at_level(logging.WARNING, logger="portfolio.calendars"):
        assert is_trading_day("IN", at(IST, 2026, 8, 6, 10, 0), holidays_dir=tmp_path)
        assert market_open("IN", at(IST, 2026, 8, 6, 10, 0), holidays_dir=tmp_path)
    assert any("holiday file missing" in r.getMessage() for r in caplog.records)
    # A date that would be a holiday in the shipped files is treated as open.
    assert is_trading_day("IN", at(IST, 2026, 1, 26, 10, 0), holidays_dir=tmp_path)


def test_corrupt_holiday_file_degrades(tmp_path, caplog):
    (tmp_path / "nse_2026.json").write_text("not json {", encoding="utf-8")
    with caplog.at_level(logging.WARNING, logger="portfolio.calendars"):
        assert is_trading_day("IN", at(IST, 2026, 1, 26, 10, 0), holidays_dir=tmp_path)
    assert any("cannot parse holiday file" in r.getMessage() for r in caplog.records)


def test_weekend_holiday_precedence(holidays_dir):
    # 2026-08-15 is a Saturday AND listed in the NSE fixture; "weekend" wins.
    assert reason_closed("IN", at(IST, 2026, 8, 15, 10, 0), holidays_dir=holidays_dir) == "weekend"


def test_holidays_loaded_lazily_once(holidays_dir):
    # First call loads + caches; rewriting the file must NOT change the answer
    # until the cache is reset (one process == one run == one read).
    d = at(IST, 2026, 1, 26, 10, 0)
    assert not is_trading_day("IN", d, holidays_dir=holidays_dir)
    (holidays_dir / "nse_2026.json").write_text(
        json.dumps({"exchange": "NSE", "year": 2026, "source": "test", "holidays": []}),
        encoding="utf-8",
    )
    assert not is_trading_day("IN", d, holidays_dir=holidays_dir)  # still cached
    reset_calendar_cache()
    assert is_trading_day("IN", d, holidays_dir=holidays_dir)  # re-read -> no holiday


def test_determinism_same_input_same_answer(holidays_dir):
    """The M4 gate contract: identical (geography, dt, is_eod) -> identical answer."""
    dt = at(IST, 2026, 8, 6, 18, 30)
    first = gate_check("IN", dt, is_eod=False, holidays_dir=holidays_dir)
    assert gate_check("IN", dt, is_eod=False, holidays_dir=holidays_dir) == first
    # The same instant from UTC also answers identically (normalized internally).
    same_instant = at(UTC, 2026, 8, 6, 13, 0)  # 18:30 IST
    assert gate_check("IN", same_instant, is_eod=False, holidays_dir=holidays_dir) == first


# ---- year-rolling holiday files (post-M4) ------------------------------------
#
# The file is resolved by the YEAR OF THE EVALUATED DATE
# (holidays_pattern.format(year=local.year)): dropping nse_2027.json into
# data/holidays/ is the ONLY step needed for 2027 - no code edit. These tests
# prove the roll and that the 2026 list never leaks into 2027.


def test_year_pattern_honors_2027_fixture(tmp_path):
    """A nse_2027.json fixture is picked up for 2027 dates with no code edit."""
    (tmp_path / "nse_2027.json").write_text(
        json.dumps(
            {
                "exchange": "NSE",
                "year": 2027,
                "source": "test fixture",
                "holidays": [{"date": "2027-01-26", "name": "Republic Day 2027"}],
            }
        ),
        encoding="utf-8",
    )
    d27 = at(IST, 2027, 1, 26, 10, 0)  # Tuesday
    assert not is_trading_day("IN", d27, holidays_dir=tmp_path)
    assert gate_check("IN", d27, is_eod=False, holidays_dir=tmp_path) == "holiday: Republic Day 2027"


def test_year_pattern_missing_2027_file_degrades_without_leak(tmp_path, caplog):
    """No nse_2027.json -> 2027 dates degrade to weekday-only; the 2026 list
    must NOT make 2027-01-26 a holiday, and the warning names the missing year
    file. The 2026 holiday still holds for 2026 dates from the same dir."""
    (tmp_path / "nse_2026.json").write_text(
        json.dumps(
            {
                "exchange": "NSE",
                "year": 2026,
                "source": "test fixture",
                "holidays": [{"date": "2026-01-26", "name": "Republic Day"}],
            }
        ),
        encoding="utf-8",
    )
    d27 = at(IST, 2027, 1, 26, 10, 0)  # Tuesday
    with caplog.at_level(logging.WARNING, logger="portfolio.calendars"):
        assert is_trading_day("IN", d27, holidays_dir=tmp_path)  # weekday-only
        assert gate_check("IN", d27, is_eod=False, holidays_dir=tmp_path) is None
    assert any("nse_2027.json" in r.getMessage() for r in caplog.records)
    # the SAME dir still serves the 2026 list for 2026 dates
    assert (
        gate_check("IN", at(IST, 2026, 1, 26, 10, 0), is_eod=False, holidays_dir=tmp_path)
        == "holiday: Republic Day"
    )
