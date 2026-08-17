"""Market calendars for the scheduling gate (M4) — pure and deterministic.

Why this module is pure: M4's job is "schedule the right runs at the right
times", and the calendar gate is the pipeline's SECOND layer of defense behind
Windows Task Scheduler. Task Scheduler fires at fixed wall-clock times (09:45,
15:45 IST, ...) but it cannot know about holidays or retries: a job that fires
on a holiday, or a retried run that lands at midnight, must still decide
"should I run?" in exactly one way. Every function therefore takes the wall
clock as an ARGUMENT (`dt`) instead of reading `datetime.now()` itself — the
same (geography, dt, is_eod) always yields the same answer, which is what makes
the gate testable and the pipeline deterministic. Callers pass the time in;
this module never looks at a clock.

Why zoneinfo and never hardcoded offsets: NSE runs 09:15–15:30 IST (UTC+05:30,
no DST — India has observed permanent standard time since 1970) but NYSE runs
09:30–16:00 ET, and Eastern Time shifts between EST (UTC-05:00) and EDT
(UTC-04:00) every spring and fall. A hardcoded "UTC-5" would be wrong half the
year. zoneinfo reads the IANA tz database (the same one every OS uses), so
"09:30 on 2026-03-09" is automatically EDT and "09:30 on 2026-11-02" EST — the
DST tests prove exactly that.

Boundary semantics: open is INCLUSIVE, close EXCLUSIVE — 09:30:00 ET is open,
16:00:00 ET is closed. The 15:45 IST EOD task fires after the 15:30 IST NSE
close precisely because close time is exclusive.

The gate policy (`gate_check`): weekends and holidays block BOTH live and EOD
runs; on a trading day, EOD runs pass at ANY time, while live polls only pass
inside the open window.

Holidays come from committed per-year JSON files in config.HOLIDAYS_DIR
(nse_2026.json / nyse_2026.json, ...), resolved by the YEAR OF THE EVALUATED
DATE: each market's `holidays_pattern` (e.g. "nse_{year}.json") is filled from
the market-local year of `dt` — rolling to a new year means dropping the new
year's JSON into data/holidays/, no code edit. Files load lazily once per
process and are cached by (geography, RESOLVED file path), so different years
cache separately with no extra logic. A missing or unparseable file degrades
to "no holidays" with a warning naming the missing year file — the gate is
advisory (it must never hard-fail a scheduled run; running on a holiday is
merely useless, not dangerous) and production ships the files.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

from portfolio.config import HOLIDAYS_DIR

logger = logging.getLogger("portfolio.calendars")

# Lazy holiday cache: (geography, resolved-file-path) -> {ISO date: holiday name}.
# One process == one run, so this cache never outlives a run; it only stops the
# gate from re-reading the JSON on every per-platform poll inside `--all`.
# Different years resolve to different paths, so the cache is year-correct.
_HOLIDAY_CACHE: dict[tuple[str, str], dict[str, str]] = {}


@dataclass(frozen=True)
class Market:
    """One exchange's schedule. Times are LOCAL to `tz`."""

    geography: str
    tz: ZoneInfo
    open_time: time
    close_time: time
    # Per-year JSON template; the year is filled from the EVALUATED date's
    # market-local year (never the wall clock) - see _load_holidays.
    holidays_pattern: str


# The single source of truth. Rolling to a new year = dropping the year's JSON
# into data/holidays/ (nse_2027.json, ...) - the gate resolves the file from
# the EVALUATED DATE's year, so no code edit is ever needed.
_MARKETS: dict[str, Market] = {
    "IN": Market("IN", ZoneInfo("Asia/Kolkata"), time(9, 15), time(15, 30), "nse_{year}.json"),
    "US": Market("US", ZoneInfo("America/New_York"), time(9, 30), time(16, 0), "nyse_{year}.json"),
}


def _market(geography: str) -> Market:
    try:
        return _MARKETS[geography]
    except KeyError as exc:
        raise ValueError(f"unknown geography: {geography!r} (expected IN or US)") from exc


def _local(market: Market, dt: datetime) -> datetime:
    """Convert `dt` to the market's zone; refuse naive datetimes.

    A naive datetime has no offset, so astimezone would silently attach the
    MACHINE's zone — the gate would answer differently on different hosts,
    breaking the determinism contract. Refuse loudly rather than guess.
    """
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError(f"calendars.{market.geography} requires a timezone-aware datetime, got: {dt!r}")
    return dt.astimezone(market.tz)


def _holidays_dir(holidays_dir: Path | None) -> Path:
    return Path(holidays_dir) if holidays_dir is not None else HOLIDAYS_DIR


def _load_holidays(geography: str, local: datetime, holidays_dir: Path | None) -> dict[str, str]:
    """Lazily load {ISO date: name} for a market's year of the evaluated date.

    The file is resolved by the MARKET-LOCAL year of `dt` (never the wall
    clock): holidays_pattern.format(year=local.year). A missing or unparseable
    file degrades to weekday-only logic with a warning that names the missing
    year file. Loaded ONCE per (geography, resolved file path) - different
    years resolve to different paths, so the cache is automatically
    year-correct.
    """
    market = _market(geography)
    filename = market.holidays_pattern.format(year=local.year)
    path = _holidays_dir(holidays_dir) / filename
    key = (geography, str(path))
    if key in _HOLIDAY_CACHE:
        return _HOLIDAY_CACHE[key]

    holidays: dict[str, str] = {}
    if not path.exists():
        logger.warning(
            "holiday file missing: %s — %s gate degrades to weekday-only (no holidays)",
            path,
            geography,
        )
    else:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            for item in payload.get("holidays", []):
                holidays[str(item["date"])] = str(item["name"])
        except (OSError, ValueError, TypeError, KeyError) as exc:
            logger.warning(
                "cannot parse holiday file %s (%s) — %s gate degrades to weekday-only",
                path,
                exc,
                geography,
            )
    _HOLIDAY_CACHE[key] = holidays
    return holidays


def _holiday_name(geography: str, local: datetime, holidays_dir: Path | None) -> str | None:
    return _load_holidays(geography, local, holidays_dir).get(local.date().isoformat())


def _window_reason(market: Market, local: datetime) -> str | None:
    """Before-open / after-close message, or None when inside [open, close)."""
    if local.time() < market.open_time:
        return _window_message("before open", market, local, market.open_time)
    if local.time() >= market.close_time:
        return _window_message("after close", market, local, market.close_time)
    return None


def _window_message(prefix: str, market: Market, local: datetime, t: time) -> str:
    # zoneinfo.tzname is DST-aware: "IST" for Kolkata year-round, "EDT" in
    # summer vs "EST" in winter for New York — deterministic per (market, dt).
    label = market.tz.tzname(local) or market.tz.key
    return f"{prefix} ({t.strftime('%H:%M')} {label})"


# ---- public API ------------------------------------------------------------


def is_trading_day(geography: str, dt: datetime, *, holidays_dir: Path | None = None) -> bool:
    """True on a weekday that is not a holiday in that market's list."""
    market = _market(geography)
    local = _local(market, dt)
    if local.weekday() >= 5:
        return False
    return _holiday_name(geography, local, holidays_dir) is None


def market_open(geography: str, dt: datetime, *, holidays_dir: Path | None = None) -> bool:
    """True on a trading day inside [open, close) — identical to a live gate pass."""
    return gate_check(geography, dt, is_eod=False, holidays_dir=holidays_dir) is None


def reason_closed(geography: str, dt: datetime, *, holidays_dir: Path | None = None) -> str | None:
    """None when the market is OPEN (for a live poll), else the human reason:
    "weekend", "holiday: <name>", "before open (HH:MM <TZ>)" or
    "after close (HH:MM <TZ>)" in the market's local time.
    """
    market = _market(geography)
    local = _local(market, dt)
    if local.weekday() >= 5:
        return "weekend"
    name = _holiday_name(geography, local, holidays_dir)
    if name is not None:
        return f"holiday: {name}"
    return _window_reason(market, local)


def gate_check(
    geography: str,
    dt: datetime,
    *,
    is_eod: bool,
    holidays_dir: Path | None = None,
) -> str | None:
    """Scheduling policy: None = allowed to run, else the blocking reason.

    - Not a trading day -> "weekend" / "holiday: <name>" (live and EOD agree).
    - Trading day + EOD  -> None at ANY time (the 15:45 IST EOD task fires
      after the 15:30 IST NSE close).
    - Trading day + live -> None only inside [open, close).
    """
    market = _market(geography)
    local = _local(market, dt)
    if local.weekday() >= 5:
        return "weekend"
    name = _holiday_name(geography, local, holidays_dir)
    if name is not None:
        return f"holiday: {name}"
    if is_eod:
        return None
    return _window_reason(market, local)


def reset_calendar_cache() -> None:
    """Clear the lazy holiday cache (tests only — one process == one run)."""
    _HOLIDAY_CACHE.clear()
