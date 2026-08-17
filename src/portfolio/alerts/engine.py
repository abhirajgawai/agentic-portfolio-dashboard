"""M6 rule engine: structured rules -> fired alerts -> deduped Telegram delivery.

Determinism: rules are STATIC DATA loaded lazily once per process (never
re-read mid-run); evaluate() is pure given (conn, rules, injected dates) -
callers pass `today` (the market date for the dedupe key) and `now_utc` (the
evaluation instant for staleness/messages); this module never reads a clock.
No eval/exec anywhere: every rule maps to a fixed metric function below, and a
malformed rule (unknown metric/op/non-numeric threshold) simply never fires.

Dedupe contract (the "no spam on re-runs" bar): alert_events has
UNIQUE(rule_id, event_date); dedupe_and_send inserts with ON CONFLICT DO
NOTHING, so only the FIRST evaluation of a (rule, day) delivers. A re-run the
same day (retries, the 15:55 export + a manual `portfolio alerts`) records and
sends nothing new. Delivery failures never crash the run: send_telegram logs
and returns False when unconfigured or on network errors (the event is still
recorded - dedupe is about the rule, not the delivery).

Per-item metrics (platform_stale, holding_return_pct): one rule fires at most
once per day, and its message names the WORST offender (op-aware: min for
lt/le, max for gt/ge) - no per-item spam.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import yaml

from portfolio.alerts.telegram import send_telegram
from portfolio.config import DATA_DIR, ROOT_DIR, Settings
from portfolio.returns import per_holding_return, simple_return_summary

logger = logging.getLogger("portfolio.alerts.engine")

# The M8 dashboard alerts contract lives here so the export and the CLI share
# ONE definition.
ALERTS_OUT = ROOT_DIR / "dashboard" / "public" / "data" / "alerts.json"
RULES_PATH = DATA_DIR / "rules.yaml"

# Asia/Kolkata is the ledger's market-date timezone (NIT-2 convention; the
# calendars module pins the same zone). The alert dedupe key is the KOLKATA
# day, never the UTC day.
_IST = ZoneInfo("Asia/Kolkata")

# Mirrors export_json's per-platform staleness thresholds (brokers refresh
# daily, CAS platforms on the monthly import cadence).
PLATFORM_STALE_DAYS: dict[str, float] = {
    "zerodha": 2.0,
    "moomoo": 2.0,
    "groww": 35.0,
    "sharekhan": 35.0,
}
DEFAULT_STALE_DAYS = 2.0

# Rules are static data: one load per path per process.
_RULES_CACHE: dict[Path, list[dict[str, Any]]] = {}

_OPS: dict[str, Any] = {
    "lt": lambda v, t: v < t,
    "le": lambda v, t: v <= t,
    "gt": lambda v, t: v > t,
    "ge": lambda v, t: v >= t,
}


def kolkata_date(now: datetime) -> str:
    """The ledger's market date for `now` — Asia/Kolkata (NIT-2 convention;
    calendars.py pins the same zone, snapshot.py uses datetime.now(_IST)).

    The alert dedupe key (event_date) MUST be the Kolkata day: between 18:30
    and midnight IST the UTC date lags Kolkata by a day, so a UTC-derived key
    would dedupe on the wrong day and collide with the next Kolkata day.
    Deterministic: the same instant always maps to the same date.
    """
    _require_aware(now)
    return now.astimezone(_IST).date().isoformat()


def load_rules(path: Path | None = None) -> list[dict[str, Any]]:
    """Load rules lazily (static data, cached per path). Missing/unparseable
    file or a non-list payload -> [] with a warning - alerts are advisory and
    must never break the run."""
    path = Path(path) if path is not None else RULES_PATH
    if path in _RULES_CACHE:
        return _RULES_CACHE[path]
    if not path.exists():
        logger.warning("rules file missing: %s - no alerts configured", path)
        _RULES_CACHE[path] = []
        return _RULES_CACHE[path]
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        logger.warning("cannot parse rules file %s (%s) - no alerts configured", path, exc)
        _RULES_CACHE[path] = []
        return _RULES_CACHE[path]
    rules = payload.get("rules", []) if isinstance(payload, dict) else []
    _RULES_CACHE[path] = [r for r in rules if isinstance(r, dict)]
    return _RULES_CACHE[path]


def evaluate(
    conn: Any,
    rules: list[dict[str, Any]],
    *,
    today: str,
    now_utc: datetime,
) -> list[dict[str, Any]]:
    """Evaluate rules against the DB. Pure given the inputs (no wall clock).

    Returns fired alerts (one per rule): [{rule_id, name, severity, value,
    threshold, label, metric, message}]. `today` is the dedupe key's market
    date and must be kolkata_date(now_utc) - the Asia/Kolkata day, never the
    UTC day (MINOR-1); it flows unchanged to dedupe_and_send.
    """
    _require_aware(now_utc)
    ctx = _build_context(conn, now_utc)
    fired: list[dict[str, Any]] = []
    for rule in rules:
        rule_id = str(rule.get("id") or "").strip()
        if not rule_id:
            logger.warning("rule without id ignored: %r", rule)
            continue
        samples = _metric_samples(rule, ctx)
        threshold = rule.get("threshold")
        op = str(rule.get("op") or "")
        hits = [(v, label) for v, label in samples if _compare(v, op, threshold)]
        if not hits:
            continue
        value, label = _worst(hits, op)
        fired.append(
            {
                "rule_id": rule_id,
                "name": str(rule.get("name") or rule_id),
                "severity": str(rule.get("severity") or "info"),
                "value": value,
                "threshold": threshold,
                "label": label,
                "metric": str(rule.get("metric") or ""),
                "message": _format_message(rule, value, threshold, label, now_utc),
            }
        )
    return fired


def dedupe_and_send(
    conn: Any,
    fired: list[dict[str, Any]],
    *,
    today: str,
    now_utc: datetime,
) -> list[dict[str, Any]]:
    """Persist NEW events (UNIQUE(rule_id, event_date) -> first wins) and send
    ONE Telegram message per run containing all new alerts.

    Returns the NEW events (already inserted). Sending failures are handled by
    send_telegram (logs + returns False); the event is recorded either way so
    the same-day dedupe stays honest. `today` must be kolkata_date(now_utc)
    (MINOR-1) - it becomes the event_date dedupe key.
    """
    _require_aware(now_utc)
    new_events: list[dict[str, Any]] = []
    for alert in fired:
        row = conn.execute(
            "INSERT INTO alert_events (rule_id, event_date, severity, message, created_at)"
            " VALUES (?,?,?,?,?) ON CONFLICT(rule_id, event_date) DO NOTHING",
            (alert["rule_id"], today, alert["severity"], alert["message"], now_utc.isoformat()),
        )
        conn.commit()
        if row.rowcount:
            new_events.append(alert)
    if new_events:
        send_telegram(_batch_message(new_events, now_utc))
    return new_events


def write_alerts_json(
    fired: list[dict[str, Any]],
    *,
    now_utc: datetime,
    path: Path | None = None,
) -> Path:
    """Write the M8 alerts.json contract: {generatedAt, alerts: [fired events]}.

    Shows ALL fired events for the run (already-sent or not - the dashboard
    renders today's state; Telegram dedupes separately via alert_events).
    """
    path = Path(path) if path is not None else ALERTS_OUT
    payload = {
        "generatedAt": now_utc.isoformat(),
        "alerts": [
            {"ruleId": a["rule_id"], "severity": a["severity"], "message": a["message"]}
            for a in fired
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


# ---- metric computation (read-only DB queries, injected clock) ----------------


def _require_aware(value: datetime, what: str = "now_utc") -> None:
    """Refuse naive datetimes loudly (mirrors calendars._local): a naive clock
    would silently corrupt the staleness math (aware-as_of minus naive-now
    raises TypeError deep inside a metric). Callers pass aware UTC."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"alerts.engine {what} must be timezone-aware, got: {value!r}")


def _same_date_fx_rates(conn: Any, base: str, quotes: list[str]) -> dict[str, float]:
    """{quote: rate} for `quotes` from ONE rate_date - the export_json.load_fx
    contract (MINOR-5): picking each quote's latest rate independently could
    divide a month-old SGD into today's USD. Returns {} when no single
    rate_date covers ALL quotes (the caller then warn-and-excludes those
    currencies - never a fabricated rate)."""
    if not quotes:
        return {}
    marks = ", ".join("?" for _ in quotes)
    row = conn.execute(
        f"SELECT rate_date FROM fx_rate WHERE base = ? AND quote IN ({marks})"
        " GROUP BY rate_date HAVING COUNT(DISTINCT quote) = ?"
        " ORDER BY rate_date DESC LIMIT 1",
        (base, *quotes, len(quotes)),
    ).fetchone()
    if row is None:
        return {}
    return {
        str(r["quote"]): float(r["rate"])
        for r in conn.execute(
            f"SELECT quote, rate FROM fx_rate WHERE base = ? AND rate_date = ?"
            f" AND quote IN ({marks})",
            (base, row["rate_date"], *quotes),
        )
    }


def _build_context(conn: Any, now_utc: datetime) -> dict[str, Any]:
    base = Settings().base_currency

    total_row = conn.execute(
        "SELECT COALESCE(SUM(market_value_base), 0.0) AS total FROM position"
    ).fetchone()
    total_value_base = float(total_row["total"])

    # Day P&L per holding is in the HOLDING's currency; convert to base with
    # rates from ONE rate_date covering every currency that carries day P&L
    # (MINOR-2, the export_json.load_fx same-date contract). A currency with
    # no rate is excluded with a warning - never a fabricated conversion.
    ccy_rows = conn.execute(
        "SELECT i.currency AS ccy, COALESCE(SUM(p.day_change_ccy), 0.0) AS d"
        " FROM position p JOIN instrument i ON i.id = p.instrument_id"
        " GROUP BY i.currency"
    ).fetchall()
    needed = [str(r["ccy"]) for r in ccy_rows if str(r["ccy"]) != base and r["d"] != 0.0]
    rates = _same_date_fx_rates(conn, base, needed) if needed else {}
    day_pnl_base = 0.0
    for r in ccy_rows:
        ccy = str(r["ccy"])
        if ccy == base:
            day_pnl_base += r["d"]
        elif r["d"] == 0.0:
            continue
        elif ccy in rates:
            day_pnl_base += r["d"] * rates[ccy]
        else:
            logger.warning("no fx_rate for %s/%s - %s day P&L excluded from alerts", base, ccy, ccy)

    summary = simple_return_summary(conn)
    return {
        "total_value_base": total_value_base,
        "day_pnl_pct": (day_pnl_base / total_value_base * 100.0) if total_value_base else None,
        "simple_return_pct": (
            summary["portfolio_return"] * 100.0 if summary["portfolio_return"] is not None else None
        ),
        "platform_staleness": _platform_staleness(conn, now_utc),
        "holding_returns": _holding_returns(conn),
    }


def _platform_staleness(conn: Any, now_utc: datetime) -> dict[str, float]:
    """{platform: days PAST its own staleness threshold} for platforms with
    positions (negative/zero when fresh; mirrors export_json's thresholds)."""
    result: dict[str, float] = {}
    for r in conn.execute(
        "SELECT a.platform AS p, MAX(p.updated_at) AS as_of FROM position p"
        " JOIN account a ON a.id = p.account_id GROUP BY a.platform"
    ).fetchall():
        as_of = r["as_of"]
        if not as_of:
            continue
        try:
            age = (now_utc - datetime.fromisoformat(as_of)).days
        except (ValueError, TypeError):
            logger.warning("unparseable position.updated_at %r - stale metric skipped", as_of)
            continue
        threshold = PLATFORM_STALE_DAYS.get(str(r["p"]), DEFAULT_STALE_DAYS)
        result[str(r["p"])] = float(age - threshold)
    return result


def _holding_returns(conn: Any) -> dict[str, float]:
    """{ticker: simple return %} over holdings WITH a cost basis - the M3
    value-only CAS rows (NULL cost) are skipped, never a crash."""
    result: dict[str, float] = {}
    for r in conn.execute(
        "SELECT i.ticker AS t, p.cost_value_base AS cost, p.market_value_base AS mkt"
        " FROM position p JOIN instrument i ON i.id = p.instrument_id"
    ).fetchall():
        ret = per_holding_return(r["cost"], r["mkt"])
        if ret is not None:
            result[str(r["t"])] = ret * 100.0
    return result


def _metric_samples(rule: dict[str, Any], ctx: dict[str, Any]) -> list[tuple[float, str]]:
    """[(value, label)] for the rule's metric: one entry for portfolio-wide
    metrics, one per item for per-item metrics (platform_stale,
    holding_return_pct). An optional `target` restricts per-item metrics to one
    item. Unknown metrics -> [] (the rule never fires) with a warning."""
    metric = str(rule.get("metric") or "")
    target = rule.get("target")
    if metric == "total_value_base":
        return [(ctx["total_value_base"], "portfolio")]
    if metric == "day_pnl_pct":
        return [(ctx["day_pnl_pct"], "portfolio")] if ctx["day_pnl_pct"] is not None else []
    if metric == "simple_return_pct":
        return [(ctx["simple_return_pct"], "portfolio")] if ctx["simple_return_pct"] is not None else []
    if metric == "platform_stale":
        staleness = ctx["platform_staleness"]
        if target is not None:
            return [(v, str(target)) for k, v in staleness.items() if k == str(target)]
        return [(v, k) for k, v in staleness.items()]
    if metric == "holding_return_pct":
        returns_map = ctx["holding_returns"]
        if target is not None:
            return [(v, str(target)) for k, v in returns_map.items() if k == str(target)]
        return [(v, k) for k, v in returns_map.items()]
    logger.warning("unknown rule metric %r (rule %r) - rule never fires", metric, rule.get("id"))
    return []


def _compare(value: float, op: str, threshold: Any) -> bool:
    """Threshold is numeric-only (yaml gives int/float); anything else -> False
    (a malformed rule never fires, never crashes)."""
    if op not in _OPS or not isinstance(threshold, (int, float)):
        return False
    if not math.isfinite(value):
        return False
    return _OPS[op](value, float(threshold))


def _worst(hits: list[tuple[float, str]], op: str) -> tuple[float, str]:
    """The worst offender for the message: min for lt/le, max for gt/ge."""
    if op in ("lt", "le"):
        return min(hits)
    return max(hits)


def _unit(metric: str) -> str:
    if metric in ("day_pnl_pct", "simple_return_pct", "holding_return_pct"):
        return "%"
    if metric == "platform_stale":
        return "d"
    if metric == "total_value_base":
        return " " + Settings().base_currency
    return ""


def _format_message(
    rule: dict[str, Any], value: float, threshold: Any, label: str, now_utc: datetime
) -> str:
    """Rule name, severity, current value vs threshold, timestamp."""
    metric = str(rule.get("metric") or "")
    unit = _unit(metric)
    scope = f" [{label}]" if label != "portfolio" else ""
    return (
        f"{str(rule.get('name') or rule.get('id'))}{scope}: {metric} = {value:.2f}{unit}"
        f" ({rule.get('op')} {float(threshold):g}{unit})"
        f" @ {now_utc.isoformat()}"
    )


def _batch_message(new_events: list[dict[str, Any]], now_utc: datetime) -> str:
    """ONE Telegram message per run: header + one line per NEW alert."""
    lines = [f"\u26a0\ufe0f Portfolio alerts ({len(new_events)} fired) @ {now_utc.isoformat()}"]
    lines += [f"  - [{e['severity']}] {e['message']}" for e in new_events]
    return "\n".join(lines)
