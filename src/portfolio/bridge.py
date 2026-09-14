"""M8 dashboard bridge — the thin FastAPI seam between the React UI and the
pipeline/agent. Lives in the portfolio package so it can import the M7 agent
client in-process (no proxy hops).

Endpoints:

    GET  /api/health   -> {pipeline: {asOf, exportsPresent, exportsGeneratedAt}, agent: bool,
                            daemons: {zerodha: {reachable, authenticated}}}
    POST /api/refresh  -> {ok: true, summary} | 502 {ok: false, error}
    POST /api/live     -> {ok: true, holdings, asOf, platforms} | 502 {ok: false, error}
    POST /api/cas/import -> {ok: true, import, export} | 502 {ok: false, error}
    POST /api/cas/request -> {ok: true, message} | 502 {ok: false, error}
    POST /api/cas/auto -> {ok: true, message} | 502 {ok: false, error} (blocks up to CAS_AUTO_TIMEOUT_S)
    GET  /api/cas/schedule -> {ok: true, intervalDays, enabled, lastRequestedAt, nextDueAt, due, reason} | 502 {ok: false, error}
    PUT  /api/cas/schedule -> same shape as GET | 422/502 {ok: false, error}
    POST /api/property/import -> {ok: true, import, export} | 502 {ok: false, error}
    DELETE /api/property/{id} -> {ok: true, deleted, export} | 502 {ok: false, error}
    POST /api/goals -> {ok: true, goal} | 422/404/502 {ok: false, error}
    PATCH /api/goals/{id} -> {ok: true, goal} | 422/404/502 {ok: false, error}
    DELETE /api/goals/{id} -> {ok: true, deleted, export} | 404/502 {ok: false, error}
    POST /api/manual-holding -> {ok: true, result, export} | 422/502 {ok: false, error} (body: {platform, value})
    DELETE /api/manual-holding/{platform} -> {ok: true, deleted, export} | 404/502 {ok: false, error}
    GET  /api/jobs/status -> {ok: true, jobs: {zerodha, moomoo, cams, cams_fetch}} | 502 {ok: false, error}
    POST /api/snapshot/{platform} -> {ok: true, summary} | 422/502 {ok: false, error} (platform: zerodha|moomoo)
    POST /api/agent/wake -> {ok: true, state: "already-online"|"started"} | 502 {ok: false, error}
    POST /api/ask      -> {answer, toolCalls, turns, withinBudget} | 503

Guardrails:
    - Binds loopback only when served (default 127.0.0.1:8001 — uvicorn flag,
      overridable via PORTFOLIO_BRIDGE_PORT; :8000 belongs to Cardora now).
    - CORS allows the Vite dev origin; the dev proxy means the browser talks
      to the same origin anyway (CORS is belt-and-suspenders).
    - NEVER touches broker MCPs or the DB directly: refresh shells out to the
      real pipeline CLI (snapshot --all --force + export_json.py), exactly the
      scheduled path. Determinism boundary holds: the LLM only enters through
      /api/ask -> OpenCodeClient (M7).
    - No secrets: no tokens are read or echoed here. Agent auth comes from
      OPENCODE_SERVER_PASSWORD via the M7 client's own env handling.
    - File uploads (CAS PDF) are validated by content type and size.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import subprocess
import sys
from datetime import UTC, datetime

from fastapi import FastAPI, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from portfolio.agent.client import OpenCodeClient
from portfolio.agent.wake import AgentWakeError, ensure_agent_online
from portfolio.config import ROOT_DIR

logger = logging.getLogger("portfolio.bridge")

app = FastAPI(title="portfolio-dashboard-bridge", version="0.1.0")

# The Vite dev server origin(s) the SPA is served from. /api/* is proxied by
# Vite, so these matter only for direct cross-origin calls to the bridge port
# (127.0.0.1:8001 by default). Both the
# 5173 (original) and 5174 (current Vite default port) origins are allowed —
# the port is not pinned, so a direct fetch from either must not be blocked.
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

# Pipeline refresh subprocess budgets: the snapshot leg pulls live brokers
# (daemon RPC + OpenD) and can take minutes; the export is a quick DB read.
REFRESH_TIMEOUT_S = 900
EXPORT_TIMEOUT_S = 120

# Live fetch budget: 35s (broker calls + normalization; 30s CLI + buffer)
LIVE_TIMEOUT_S = 35

# Goal CLI budget: a fast local SQLite write via `portfolio goal` (M8.9).
GOAL_TIMEOUT_S = 30

DATA_DIR = ROOT_DIR / "dashboard" / "public" / "data"

EXPORT_FILES = ("latest.json", "history.json", "alerts.json", "xirr.json", "performance.json")


def _latest_as_of() -> str | None:
    """asOf from the exported latest.json ('' -> None when unreadable)."""
    try:
        payload = json.loads((DATA_DIR / "latest.json").read_text(encoding="utf-8"))
        return payload.get("asOf")
    except (OSError, ValueError):
        return None


def _exports_present() -> bool:
    return all((DATA_DIR / f).is_file() for f in EXPORT_FILES)


def _exports_generated_at() -> str | None:
    """Latest mtime across the export files, ISO UTC — "when the dashboard data
    was last regenerated". The reload banner keys on THIS advancing: it must be
    the FILE time (the files actually changed), not the pipeline asOf (a run
    time that can advance without any export). None when no export exists yet."""
    try:
        mtimes = [(DATA_DIR / f).stat().st_mtime for f in EXPORT_FILES if (DATA_DIR / f).is_file()]
    except OSError:
        return None
    return datetime.fromtimestamp(max(mtimes), tz=UTC).isoformat() if mtimes else None


def _zerodha_daemon_health() -> dict:
    """Live Zerodha session-daemon reachability (GET :8788/health, ~3s
    timeout) - reuses snapshot.daemon_health() so the bridge's UI signal and
    the pipeline's own daemon-readiness check never drift apart. Moomoo has no
    equivalent: it's OpenD (a local desktop app) + a per-run MCP subprocess,
    not a persistent server, so there's nothing cheap to ping here - its
    status comes from the last snapshot/live-poll `runs` row instead
    (/api/jobs/status), not this endpoint."""
    from portfolio.snapshot import daemon_health

    health = daemon_health()
    if health is None:
        return {"reachable": False, "authenticated": False}
    return {"reachable": bool(health.get("ok")), "authenticated": bool(health.get("auth"))}


@app.get("/api/health")
async def health() -> dict:
    """Pipeline freshness (export files) + agent reachability (M7 client) +
    live Zerodha daemon reachability."""
    agent = await OpenCodeClient().health()
    zerodha_daemon = await asyncio.to_thread(_zerodha_daemon_health)
    return {
        "pipeline": {
            "asOf": _latest_as_of(),
            "exportsPresent": _exports_present(),
            "exportsGeneratedAt": _exports_generated_at(),
        },
        "agent": agent,
        "daemons": {"zerodha": zerodha_daemon},
    }


def _run_pipeline() -> dict:
    """Run snapshot --platform all --force then export_json.py; return a
    per-leg summary.

    snapshot --platform all catches per-leg exceptions and continues (M3.5),
    so a moomoo/OpenD failure is reported INSIDE the summary as a failed leg —
    it does not crash the refresh. The overall refresh only fails when the
    pipeline itself cannot run or the export fails.
    """
    snapshot = subprocess.run(
        [sys.executable, "-m", "portfolio.cli", "snapshot", "--platform", "all", "--force"],
        capture_output=True,
        text=True,
        timeout=REFRESH_TIMEOUT_S,
        cwd=ROOT_DIR,
    )
    export = subprocess.run(
        [sys.executable, "scripts/export_json.py"],
        capture_output=True,
        text=True,
        timeout=EXPORT_TIMEOUT_S,
        cwd=ROOT_DIR,
    )
    return {
        "snapshot": {
            "exitCode": snapshot.returncode,
            "stdout": (snapshot.stdout or "").strip()[-2000:],
            "stderr": (snapshot.stderr or "").strip()[-2000:],
        },
        "export": {
            "exitCode": export.returncode,
            "stdout": (export.stdout or "").strip()[-2000:],
            "stderr": (export.stderr or "").strip()[-2000:],
        },
    }


def _run_live_fetch() -> dict:
    """Fetch live holdings from all platforms (zerodha + moomoo) without DB persistence.

    Returns normalized holdings with dayPnl, dayChangePct, valueBase, etc.
    Mirrors the snapshot logic but skips persistence and runs in a single process.
    """
    from portfolio.config import Settings
    from portfolio.fx import get_fx_rates
    from portfolio.normalize.sectors import load_names, load_sectors
    from portfolio.normalize.zerodha import normalize_holdings as normalize_zerodha
    from portfolio.snapshot import (
        DEFAULT_PORT,
        SessionNotReady,
        _collect_moomoo,
        _fetch,
        _session_expired,
        ensure_zerodha_daemon,
    )

    # ---- Zerodha leg ----
    zerodha_holdings = []
    zerodha_status = "ok"
    zerodha_error = None

    try:
        ensure_zerodha_daemon()
        raw = _fetch(DEFAULT_PORT, "get_holdings", {})
        if _session_expired(raw):
            raise SessionNotReady("Zerodha session expired")
        payload = raw.get("parse", [])
        if not isinstance(payload, list):
            raise SessionNotReady(f"unexpected holdings payload: {type(payload).__name__}")
        zerodha_holdings = normalize_zerodha(payload, sectors=load_sectors(), names=load_names())
    except SessionNotReady as exc:
        zerodha_status = "error"
        zerodha_error = str(exc)
    except Exception as exc:  # noqa: BLE001
        zerodha_status = "error"
        zerodha_error = f"{type(exc).__name__}: {exc}"

    # ---- Moomoo leg ----
    moomoo_holdings = []
    moomoo_status = "ok"
    moomoo_error = None

    try:
        import asyncio

        holdings, _ = asyncio.run(_collect_moomoo())
        moomoo_holdings = holdings
    except SessionNotReady as exc:
        moomoo_status = "error"
        moomoo_error = str(exc)
    except Exception as exc:  # noqa: BLE001
        moomoo_status = "error"
        moomoo_error = f"{type(exc).__name__}: {exc}"

    all_holdings = zerodha_holdings + moomoo_holdings

    # ---- FX rates (one rate per run) ----
    base = Settings().base_currency
    currencies = sorted({h.currency for h in all_holdings})
    rates = get_fx_rates(base, currencies)
    rates[base] = 1.0

    # ---- Build holdings output with valueBase, dayPnl, etc. ----
    holdings_out = []
    for h in all_holdings:
        fx_rate = rates.get(h.currency, 1.0)
        value_base = h.current_value * fx_rate
        cost_base = h.cost_basis * fx_rate if h.cost_basis else None

        return_pct = None
        if cost_base:
            return_pct = round((value_base - cost_base) / cost_base * 100.0, 2)

        holdings_out.append({
            "platform": h.platform,
            "geography": h.geography,
            "ticker": h.ticker,
            "name": h.name,
            "isin": h.isin,
            "currency": h.currency,
            "qty": h.quantity,
            "avgPrice": h.avg_price,
            "ltp": h.current_price,
            "value": h.current_value,
            "valueBase": round(value_base, 2),
            "valueDisplay": round(value_base, 2),  # base == display for live
            "displayCurrency": base,
            "asOf": datetime.now(UTC).isoformat(),
            "returnPct": return_pct,
            "dayPnl": h.day_change_ccy,
            "dayChangePct": round(h.day_change_pct, 2) if h.day_change_pct is not None else None,
            "pnl": h.pnl_ccy,
            "pnlPct": round(h.pnl_pct, 2) if h.pnl_pct is not None else None,
            "canSellQty": h.can_sell_qty,
            "positionSide": h.position_side,
            "sector": h.sector,
            "assetClass": h.asset_class,
        })

    # ---- Platform summary ----
    platforms = {
        "zerodha": {"holdings": len(zerodha_holdings), "status": zerodha_status},
        "moomoo": {"holdings": len(moomoo_holdings), "status": moomoo_status},
    }
    if zerodha_error:
        platforms["zerodha"]["error"] = zerodha_error
    if moomoo_error:
        platforms["moomoo"]["error"] = moomoo_error

    return {
        "holdings": holdings_out,
        "asOf": datetime.now(UTC).isoformat(),
        "platforms": platforms,
    }


@app.post("/api/live")
async def live() -> JSONResponse:
    """Fetch fresh live holdings from all platforms; 200 {ok, holdings, asOf, platforms} or clean 502."""
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_run_live_fetch),
            timeout=LIVE_TIMEOUT_S,
        )
    except TimeoutError:
        logger.error("live fetch timed out after %ds", LIVE_TIMEOUT_S)
        return JSONResponse(status_code=502, content={"ok": False, "error": "live fetch timed out"})
    except Exception as exc:  # noqa: BLE001 - clean 502, never a traceback
        logger.exception("live fetch failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})

    return JSONResponse(content={"ok": True, **result})


_SNAPSHOT_PLATFORMS = frozenset({"zerodha", "moomoo"})


def _run_snapshot(platform: str) -> dict:
    """Run `snapshot --platform <platform> --force --eod` then export_json.py —
    same shape as _run_pipeline but scoped to one leg (the Jobs status
    screen's per-platform "take snapshot now" button). Always --force: the
    button is meant to work outside market hours too, for on-demand checks.

    Always --eod too (2026-08-27): db/persist.py only writes position_snapshot
    - the row history.json/AccountRoads is derived from - when is_eod=True;
    without it this only updates the live `position` table. The scheduled
    PortfolioSnapshotEod task used to be the sole is_eod=True writer for
    zerodha/moomoo; now that scheduled snapshots are gone in favor of
    on-demand triggers (laptop isn't always on), THIS is the only remaining
    place that can advance the daily history series for these platforms - so
    it must write one, not just refresh the live total.
    """
    snapshot = subprocess.run(
        [sys.executable, "-m", "portfolio.cli", "snapshot", "--platform", platform, "--force", "--eod"],
        capture_output=True,
        text=True,
        timeout=REFRESH_TIMEOUT_S,
        cwd=ROOT_DIR,
    )
    export = subprocess.run(
        [sys.executable, "scripts/export_json.py"],
        capture_output=True,
        text=True,
        timeout=EXPORT_TIMEOUT_S,
        cwd=ROOT_DIR,
    )
    return {
        "snapshot": {
            "exitCode": snapshot.returncode,
            "stdout": (snapshot.stdout or "").strip()[-2000:],
            "stderr": (snapshot.stderr or "").strip()[-2000:],
        },
        "export": {
            "exitCode": export.returncode,
            "stdout": (export.stdout or "").strip()[-2000:],
            "stderr": (export.stderr or "").strip()[-2000:],
        },
    }


@app.post("/api/snapshot/{platform}")
async def snapshot_trigger(platform: str) -> JSONResponse:
    """On-demand forced snapshot for one live leg (zerodha or moomoo) — the
    Jobs status screen's manual trigger buttons. 422 for any other platform."""
    if platform not in _SNAPSHOT_PLATFORMS:
        return JSONResponse(
            status_code=422,
            content={"ok": False, "error": f"platform must be one of {sorted(_SNAPSHOT_PLATFORMS)}"},
        )
    try:
        summary = await asyncio.wait_for(
            asyncio.to_thread(_run_snapshot, platform), timeout=REFRESH_TIMEOUT_S + 30,
        )
    except (TimeoutError, subprocess.TimeoutExpired):
        logger.error("snapshot %s timed out", platform)
        return JSONResponse(status_code=502, content={"ok": False, "error": "snapshot timed out"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("snapshot %s failed", platform)
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})

    ok = summary["snapshot"]["exitCode"] == 0 and summary["export"]["exitCode"] == 0
    if not ok:
        return JSONResponse(status_code=502, content={"ok": False, "error": json.dumps(summary, default=str)})
    return JSONResponse(content={"ok": True, "summary": summary})


_JOB_PLATFORMS = ("zerodha", "moomoo", "cams", "cams_fetch")


def _latest_runs_by_platform(platforms: tuple[str, ...]) -> dict[str, dict | None]:
    """Latest `runs` row per platform (read-only) — the Jobs status screen's
    data source. Reads the DB directly since this is a pure read, same as the
    property/manual delete paths' direct DB access for mutations."""
    from portfolio.config import DB_PATH
    from portfolio.db import connect

    conn = connect(DB_PATH)
    try:
        result: dict[str, dict | None] = {}
        for platform in platforms:
            row = conn.execute(
                "SELECT platform, snapshot_date, status, started_at, rows, error"
                " FROM runs WHERE platform=? ORDER BY started_at DESC LIMIT 1",
                (platform,),
            ).fetchone()
            result[platform] = dict(row) if row else None
        return result
    finally:
        conn.close()


@app.get("/api/jobs/status")
async def jobs_status() -> JSONResponse:
    """Latest run per tracked job for the dashboard's Jobs status screen:
    zerodha + moomoo snapshots, and the Groww CAMS+KFintech automated pair
    (request + email fetch)."""
    try:
        jobs = await asyncio.to_thread(_latest_runs_by_platform, _JOB_PLATFORMS)
        return JSONResponse(content={"ok": True, "jobs": jobs})
    except Exception as exc:  # noqa: BLE001
        logger.exception("jobs status failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


@app.post("/api/refresh")
async def refresh() -> JSONResponse:
    """Trigger an on-demand pipeline run; return 200 {ok, summary} or a clean
    502 {ok: false, error} — never a traceback."""
    try:
        summary = await asyncio.to_thread(_run_pipeline)
    except subprocess.TimeoutExpired as exc:
        logger.error("refresh pipeline timed out: %s", exc)
        return JSONResponse(status_code=502, content={"ok": False, "error": "pipeline timed out"})
    except Exception as exc:  # noqa: BLE001 - surface a clean error, never a traceback
        logger.exception("refresh failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})

    snapshot_ok = summary["snapshot"]["exitCode"] == 0
    export_ok = summary["export"]["exitCode"] == 0
    if not (snapshot_ok and export_ok):
        # The schema declares error: string — serialize the summary dict so the
        # UI shows the readable failure detail instead of rejecting the payload.
        return JSONResponse(status_code=502, content={"ok": False, "error": json.dumps(summary, default=str)})
    return JSONResponse(content={"ok": True, "summary": summary})


class PropertyImportRequest(BaseModel):
    """Request body for property import from UI."""
    property_id: str
    address: str
    property_type: str = "residential"
    purchase_date: str  # YYYY-MM-DD
    purchase_price: float
    current_valuation: float
    valuation_date: str | None = None  # YYYY-MM-DD, defaults to today
    improvements: list[dict] = []  # [{date, amount, description}]


@app.post("/api/property/import")
async def property_import(req: PropertyImportRequest) -> JSONResponse:
    """Import or update a property valuation from the UI.

    Runs `portfolio property import` with the provided JSON, then regenerates
    the dashboard exports. Idempotent: re-importing the same property_id with
    a new current_valuation updates the holding + adds a new terminal trade.
    """
    import json as jsonlib
    import subprocess
    import sys
    import tempfile

    # Build the property JSON from the request
    prop_json = {
        "property_id": req.property_id,
        "address": req.address,
        "property_type": req.property_type,
        "purchase_date": req.purchase_date,
        "purchase_price": req.purchase_price,
        "current_valuation": req.current_valuation,
        "improvements": req.improvements,
    }

    # Write to a temp file and run the CLI import
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            jsonlib.dump(prop_json, f)
            temp_path = f.name

        # Run property import CLI
        import_result = subprocess.run(
            [sys.executable, "-m", "portfolio.cli", "property", "import", temp_path],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=ROOT_DIR,
        )

        if import_result.returncode != 0:
            logger.error("property import failed: %s", import_result.stderr)
            return JSONResponse(
                status_code=502,
                content={"ok": False, "error": f"import failed: {import_result.stderr[-500:]}"},
            )

        # Regenerate dashboard exports
        export_result = subprocess.run(
            [sys.executable, "scripts/export_json.py"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=ROOT_DIR,
        )

        if export_result.returncode != 0:
            logger.error("export_json failed: %s", export_result.stderr)
            return JSONResponse(
                status_code=502,
                content={"ok": False, "error": f"export failed: {export_result.stderr[-500:]}"},
            )

        return JSONResponse(
            content={
                "ok": True,
                "import": import_result.stdout.strip()[-2000:],
                "export": export_result.stdout.strip()[-2000:],
            }
        )
    except subprocess.TimeoutExpired:
        logger.error("property import timed out")
        return JSONResponse(status_code=502, content={"ok": False, "error": "import timed out"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("property import failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


class PropertyDeleteRequest(BaseModel):
    """Request body for property deletion."""
    property_id: str


@app.delete("/api/property/{property_id}")
async def property_delete(property_id: str) -> JSONResponse:
    """Delete a property and all its data from the DB.

    Removes the holding (position), position_snapshots, price_history,
    instrument, account, and trades for the given property_id.
    Then regenerates dashboard exports.
    """
    import subprocess
    import sys

    try:
        # Run a Python script to delete the property from DB
        delete_script = f"""
import sys
sys.path.insert(0, r'{ROOT_DIR}')
from portfolio.db import connect
from portfolio.config import DB_PATH

db = connect(DB_PATH)
try:
    # Find the instrument_id for this property
    inst = db.execute(
        "SELECT id FROM instrument WHERE platform='real_estate' AND ticker=?",
        ('{property_id}',)
    ).fetchone()
    if not inst:
        print(f"Property {property_id} not found")
        sys.exit(0)
    inst_id = inst['id']

    # Find the account_id
    acc = db.execute(
        "SELECT id FROM account WHERE platform='real_estate' AND account_ref='folio'"
    ).fetchone()
    if not acc:
        print(f"Account not found")
        sys.exit(0)
    acc_id = acc['id']

    # Delete in correct order (FK constraints)
    db.execute("DELETE FROM trade WHERE account_id=? AND instrument_id=?", (acc_id, inst_id))
    db.execute("DELETE FROM position_snapshot WHERE account_id=? AND instrument_id=?", (acc_id, inst_id))
    db.execute("DELETE FROM price_history WHERE instrument_id=?", (inst_id,))
    db.execute("DELETE FROM position WHERE account_id=? AND instrument_id=?", (acc_id, inst_id))
    db.execute("DELETE FROM instrument WHERE id=?", (inst_id,))
    db.commit()
    print(f"Deleted property {property_id}")
finally:
    db.close()
"""
        result = subprocess.run(
            [sys.executable, "-c", delete_script],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=ROOT_DIR,
        )

        if result.returncode != 0:
            logger.error("property delete failed: %s", result.stderr)
            return JSONResponse(
                status_code=502,
                content={"ok": False, "error": f"delete failed: {result.stderr[-500:]}"},
            )

        # Regenerate dashboard exports
        export_result = subprocess.run(
            [sys.executable, "scripts/export_json.py"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=ROOT_DIR,
        )

        if export_result.returncode != 0:
            logger.error("export_json failed: %s", export_result.stderr)
            return JSONResponse(
                status_code=502,
                content={"ok": False, "error": f"export failed: {export_result.stderr[-500:]}"},
            )

        return JSONResponse(
            content={
                "ok": True,
                "deleted": property_id,
                "export": export_result.stdout.strip()[-2000:],
            }
        )
    except subprocess.TimeoutExpired:
        logger.error("property delete timed out")
        return JSONResponse(status_code=502, content={"ok": False, "error": "delete timed out"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("property delete failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


# -- M8.9 savings goals (same seam as properties: subprocess to the venv CLI,
#    never direct DB access) -------------------------------------------------


class GoalCreateRequest(BaseModel):
    """Request body for creating a savings goal (camelCase per the UI contract)."""

    label: str
    targetAmount: float
    color: str | None = None


class GoalUpdateRequest(BaseModel):
    """Partial update body - only the provided fields reach `goal update`."""

    label: str | None = None
    targetAmount: float | None = None
    color: str | None = None


# `portfolio goal list` prints one human line per goal:
#   #3  Emergency fund  target=5,00,000.00  color=#6f7cff [crossed_at=<iso>]
_GOAL_LINE_RE = re.compile(
    r"^#(?P<id>\d+)\s+(?P<label>.+?)\s+target=(?P<target>[\d,]+(?:\.\d+)?)"
    # `.+?` (not `\S+`) — a goal color can be an oklch()/rgb()/hsl() CSS
    # function, which contains internal spaces (e.g. "oklch(0.55 0.18 262)");
    # `\S+` stopped at the first space and broke the whole line match, so a
    # freshly created/updated goal with a non-hex color could never be read
    # back (bridge.py's goal_create/goal_update then reported "created but
    # could not be read back" even though the CLI write itself succeeded).
    r"\s+color=(?P<color>.+?)(?:\s+crossed_at=(?P<crossed>.+))?$"
)


def _goal_from_list_output(stdout: str, *, goal_id: int | None = None) -> dict | None:
    """Parse one goal row out of `portfolio goal list` output.

    Readback choice: the CLI is owned elsewhere and prints human lines only,
    so the bridge parses them rather than touching SQLite directly (hard rule)
    or editing another owner's file. PATCH needs this too - a partial update
    means the bridge does not know the untouched fields.

    `goal_id=None` (create path): return the newest goal (max id) - the just-
    created row is always the highest id in the listing.
    `goal_id=<id>` (update path): return THAT goal specifically. The max-id
    heuristic is wrong here - PATCH can target any existing goal, not only
    the newest one, and picking max-id silently returned a DIFFERENT goal's
    data whenever the edited goal wasn't already the highest id (found live:
    editing goal #9 while goal #10 existed returned #10's label/target/color
    in the response body).
    """
    best: dict | None = None
    for line in stdout.splitlines():
        m = _GOAL_LINE_RE.match(line.strip())
        if not m:
            continue
        goal = {
            "id": int(m.group("id")),
            "label": m.group("label"),
            "targetAmount": float(m.group("target").replace(",", "")),
            "color": m.group("color"),
            "crossedAt": m.group("crossed"),
        }
        if goal_id is not None:
            if goal["id"] == goal_id:
                return goal
            continue
        if best is None or goal["id"] > best["id"]:
            best = goal
    return best


def _run_goal_cli(args: list[str]) -> subprocess.CompletedProcess:
    """Run a read/write `portfolio goal` subcommand in the venv interpreter."""
    return subprocess.run(
        [sys.executable, "-m", "portfolio.cli", "goal", *args],
        capture_output=True,
        text=True,
        timeout=GOAL_TIMEOUT_S,
        cwd=ROOT_DIR,
    )


def _run_export_cli() -> subprocess.CompletedProcess:
    """Regenerate dashboard/public/data/*.json - the same export invocation
    the property endpoints make after every mutation."""
    return subprocess.run(
        [sys.executable, "scripts/export_json.py"],
        capture_output=True,
        text=True,
        timeout=EXPORT_TIMEOUT_S,
        cwd=ROOT_DIR,
    )


def _invalid_target_response(amount: float) -> JSONResponse | None:
    """422 when targetAmount is not finite and > 0 - rejected BEFORE shelling
    out (isfinite also rejects inf, which would pass a bare > 0 check)."""
    if not math.isfinite(amount) or amount <= 0:
        return JSONResponse(
            status_code=422,
            content={"ok": False, "error": "targetAmount must be a finite number greater than 0"},
        )
    return None


def _goal_cli_error(result: subprocess.CompletedProcess, action: str) -> JSONResponse:
    """Map a failed goal CLI run to a clean non-2xx response: 404-style when
    the id was not found, else 502 carrying the CLI's own FAILED reason."""
    detail = ((result.stderr or "") + (result.stdout or "")).strip()[-500:]
    if "not found" in detail:
        return JSONResponse(status_code=404, content={"ok": False, "error": detail})
    return JSONResponse(status_code=502, content={"ok": False, "error": f"goal {action} failed: {detail}"})


def _export_error(result: subprocess.CompletedProcess) -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={"ok": False, "error": f"export failed: {(result.stderr or '').strip()[-500:]}"},
    )


@app.post("/api/goals")
async def goal_create(req: GoalCreateRequest) -> JSONResponse:
    """Create a savings goal from the UI.

    Runs `portfolio goal add`, reads the created row back via `goal list`
    parse, then regenerates the dashboard exports. 422 on a bad target before
    any subprocess; clean 404/502 mapping otherwise - never a traceback.
    """
    try:
        invalid = _invalid_target_response(req.targetAmount)
        if invalid:
            return invalid

        args = ["add", "--label", req.label, "--target", str(req.targetAmount)]
        if req.color:
            args += ["--color", req.color]
        result = _run_goal_cli(args)
        if result.returncode != 0:
            logger.error("goal add failed: %s", result.stderr)
            return _goal_cli_error(result, "add")

        listing = _run_goal_cli(["list"])
        goal = _goal_from_list_output(listing.stdout or "")

        export = _run_export_cli()
        if export.returncode != 0:
            logger.error("export_json failed after goal add: %s", export.stderr)
            return _export_error(export)

        if goal is None:
            return JSONResponse(
                status_code=502,
                content={"ok": False, "error": "goal created but could not be read back"},
            )
        return JSONResponse(content={"ok": True, "goal": goal})
    except subprocess.TimeoutExpired:
        logger.error("goal add timed out")
        return JSONResponse(status_code=502, content={"ok": False, "error": "goal add timed out"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("goal create failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


@app.patch("/api/goals/{goal_id}")
async def goal_update(goal_id: int, req: GoalUpdateRequest) -> JSONResponse:
    """Partially update a savings goal - only provided fields are passed to
    `goal update`; the full row is read back via `goal list` parse and the
    dashboard exports are regenerated. Unknown id -> clean 404-style error."""
    try:
        if req.label is None and req.targetAmount is None and req.color is None:
            return JSONResponse(
                status_code=422,
                content={
                    "ok": False,
                    "error": "nothing to update - pass at least one of label/targetAmount/color",
                },
            )
        if req.targetAmount is not None:
            invalid = _invalid_target_response(req.targetAmount)
            if invalid:
                return invalid

        args = ["update", str(goal_id)]
        if req.label is not None:
            args += ["--label", req.label]
        if req.targetAmount is not None:
            args += ["--target", str(req.targetAmount)]
        if req.color is not None:
            args += ["--color", req.color]
        result = _run_goal_cli(args)
        if result.returncode != 0:
            logger.error("goal update failed: %s", result.stderr)
            return _goal_cli_error(result, "update")

        listing = _run_goal_cli(["list"])
        goal = _goal_from_list_output(listing.stdout or "", goal_id=goal_id)

        export = _run_export_cli()
        if export.returncode != 0:
            logger.error("export_json failed after goal update: %s", export.stderr)
            return _export_error(export)

        if goal is None:
            return JSONResponse(
                status_code=502,
                content={"ok": False, "error": "goal updated but could not be read back"},
            )
        return JSONResponse(content={"ok": True, "goal": goal})
    except subprocess.TimeoutExpired:
        logger.error("goal update timed out")
        return JSONResponse(status_code=502, content={"ok": False, "error": "goal update timed out"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("goal update failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


@app.delete("/api/goals/{goal_id}")
async def goal_delete(goal_id: int) -> JSONResponse:
    """Delete a savings goal via `portfolio goal delete`, then regenerate the
    dashboard exports. Missing id -> clean 404-style {ok: false, error}."""
    try:
        result = _run_goal_cli(["delete", str(goal_id)])
        if result.returncode != 0:
            logger.error("goal delete failed: %s", result.stderr)
            return _goal_cli_error(result, "delete")

        export = _run_export_cli()
        if export.returncode != 0:
            logger.error("export_json failed after goal delete: %s", export.stderr)
            return _export_error(export)

        return JSONResponse(
            content={
                "ok": True,
                "deleted": goal_id,
                "export": (export.stdout or "").strip()[-2000:],
            }
        )
    except subprocess.TimeoutExpired:
        logger.error("goal delete timed out")
        return JSONResponse(status_code=502, content={"ok": False, "error": "goal delete timed out"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("goal delete failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


# -- Manual equity holdings (Groww/Sharekhan stocks - neither has an API/MCP
#    wired up, so these are hand-entered; same subprocess-to-CLI seam as
#    goals/properties, never direct DB writes from the bridge) --------------


class ManualHoldingRequest(BaseModel):
    """Request body for setting a platform's manual TOTAL equity value
    (camelCase per the UI contract). No per-share breakdown - neither Groww
    nor Sharekhan exposes an API/MCP to itemize against."""

    platform: str  # groww | sharekhan
    value: float


def _run_manual_cli(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "portfolio.cli", "manual", *args],
        capture_output=True,
        text=True,
        timeout=GOAL_TIMEOUT_S,
        cwd=ROOT_DIR,
    )


@app.post("/api/manual-holding")
async def manual_holding_set(req: ManualHoldingRequest) -> JSONResponse:
    """Set a platform's manual total equity value — value only, no cost
    basis (same convention as CAS-sourced equities). Overwrites any prior
    value for that platform."""
    try:
        if not math.isfinite(req.value) or req.value <= 0:
            return JSONResponse(
                status_code=422,
                content={"ok": False, "error": "value must be a finite number greater than 0"},
            )
        result = _run_manual_cli(["set", "--platform", req.platform, "--value", str(req.value)])
        if result.returncode != 0:
            detail = ((result.stderr or "") + (result.stdout or "")).strip()[-500:]
            logger.error("manual value set failed: %s", detail)
            return JSONResponse(status_code=502, content={"ok": False, "error": f"set failed: {detail}"})

        export = _run_export_cli()
        if export.returncode != 0:
            logger.error("export_json failed after manual value set: %s", export.stderr)
            return _export_error(export)

        return JSONResponse(
            content={
                "ok": True,
                "result": (result.stdout or "").strip()[-500:],
                "export": (export.stdout or "").strip()[-2000:],
            }
        )
    except subprocess.TimeoutExpired:
        logger.error("manual value set timed out")
        return JSONResponse(status_code=502, content={"ok": False, "error": "set timed out"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("manual value set failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


@app.delete("/api/manual-holding/{platform}")
async def manual_holding_clear(platform: str) -> JSONResponse:
    """Remove a platform's manual value entirely (e.g. fully exited the
    broker), then regenerate the dashboard exports. Unknown platform or no
    value set -> clean 404-style error."""
    try:
        result = _run_manual_cli(["clear", "--platform", platform])
        if result.returncode != 0:
            detail = ((result.stderr or "") + (result.stdout or "")).strip()[-500:]
            logger.error("manual value clear failed: %s", detail)
            status = 404 if "no manual value" in detail else 502
            return JSONResponse(status_code=status, content={"ok": False, "error": detail})

        export = _run_export_cli()
        if export.returncode != 0:
            logger.error("export_json failed after manual value clear: %s", export.stderr)
            return _export_error(export)

        return JSONResponse(
            content={
                "ok": True,
                "deleted": platform,
                "export": (export.stdout or "").strip()[-2000:],
            }
        )
    except subprocess.TimeoutExpired:
        logger.error("manual value clear timed out")
        return JSONResponse(status_code=502, content={"ok": False, "error": "clear timed out"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("manual value clear failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


@app.post("/api/cas/import")
async def cas_import(file: UploadFile, password: str = Form("")) -> JSONResponse:
    """Import a CAS PDF (Consolidated Account Statement) — the free monthly
    Groww/IN holdings path (stocks + MFs).

    Accepts a PDF file upload (CAS is emailed monthly as a PDF), runs `portfolio
    cas import` on a temp file, then regenerates the dashboard exports.
    The PDF never leaves this machine (casparser is fully offline).

    `password` MUST be declared with `Form(...)` (2026-08-24 bugfix): a bare
    `password: str = ""` alongside an `UploadFile` param makes FastAPI treat it
    as a query parameter, not a multipart form field - the frontend's real
    password was silently discarded every time, always importing with "" and
    failing with a misleading "Incorrect PDF password!" even when the user
    typed the correct one.
    """
    import os
    import tempfile

    # Security: validate file type and size
    if not file.filename:
        return JSONResponse(status_code=400, content={"ok": False, "error": "No file provided"})
    if not file.filename.lower().endswith(".pdf"):
        return JSONResponse(status_code=400, content={"ok": False, "error": "Only PDF files are allowed"})
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB limit
        return JSONResponse(status_code=400, content={"ok": False, "error": "File too large (max 10MB)"})

    try:
        # Write the uploaded PDF to a temp file
        with tempfile.NamedTemporaryFile(mode="wb", suffix=".pdf", delete=False) as f:
            f.write(content)
            temp_path = f.name

        try:
            # Run CAS import CLI
            import_result = subprocess.run(
                [sys.executable, "-m", "portfolio.cli", "cas", "import", temp_path,
                 "--password", password] if password else
                [sys.executable, "-m", "portfolio.cli", "cas", "import", temp_path],
                capture_output=True,
                text=True,
                timeout=600,  # CAS PDF parsing can be slow
                cwd=ROOT_DIR,
            )

            if import_result.returncode != 0:
                logger.error("CAS import failed: %s", import_result.stderr)
                return JSONResponse(
                    status_code=502,
                    content={"ok": False, "error": f"CAS import failed: {import_result.stderr[-500:]}"},
                )

            # Regenerate dashboard exports
            export_result = subprocess.run(
                [sys.executable, "scripts/export_json.py"],
                capture_output=True,
                text=True,
                timeout=120,
                cwd=ROOT_DIR,
            )

            if export_result.returncode != 0:
                logger.error("export_json failed after CAS import: %s", export_result.stderr)
                return JSONResponse(
                    status_code=502,
                    content={"ok": False, "error": f"export failed: {export_result.stderr[-500:]}"},
                )

            return JSONResponse(
                content={
                    "ok": True,
                    "import": import_result.stdout.strip()[-2000:],
                    "export": export_result.stdout.strip()[-2000:],
                }
            )
        finally:
            os.unlink(temp_path)
    except subprocess.TimeoutExpired:
        logger.error("CAS import timed out")
        return JSONResponse(status_code=502, content={"ok": False, "error": "import timed out (600s)"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("CAS import failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


@app.post("/api/cas/request")
async def cas_request_endpoint() -> JSONResponse:
    """Trigger the automated CAMS+KFintech CAS request (docs/CAMS_KFINTECH_CAS_PLAN.md).

    Shells out to `portfolio cas request --force` - never touches
    camsonline.com or the DB directly from the bridge process, consistent
    with every other endpoint in this file. `--force` bypasses the schedule
    gate: an explicit UI click is an intentional override, not a scheduled
    tick, the same way `/api/refresh`'s manual button bypasses the calendar
    gate. This only triggers the mailback; the PDF still arrives by email and
    is uploaded by hand via /api/cas/import (or Part B, once built).
    """
    try:
        result = subprocess.run(
            [sys.executable, "-m", "portfolio.cli", "cas", "request", "--force"],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=ROOT_DIR,
        )
        if result.returncode != 0:
            logger.error("CAS request failed: %s", result.stderr)
            return JSONResponse(
                status_code=502,
                content={"ok": False, "error": f"CAS request failed: {result.stderr[-500:]}"},
            )
        return JSONResponse(content={"ok": True, "message": result.stdout.strip()[-500:]})
    except subprocess.TimeoutExpired:
        logger.error("CAS request timed out")
        return JSONResponse(status_code=502, content={"ok": False, "error": "request timed out (60s)"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("CAS request failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


# cas auto's own email-poll timeout defaults to 600s (cli.py's --fetch-timeout);
# give the subprocess generous headroom beyond that for the request + import +
# export steps either side of the wait, so a slow-but-real run is never killed
# mid-flight and misreported as a timeout.
CAS_AUTO_TIMEOUT_S = 700


@app.post("/api/cas/auto")
async def cas_auto_endpoint() -> JSONResponse:
    """Trigger the full unattended CAS loop (Part B, docs/CAMS_KFINTECH_CAS_PLAN.md):
    request -> wait for the email -> download -> import -> refresh dashboard
    exports. Shells out to `portfolio cas auto --force`, same never-touch-
    camsonline.com/Gmail/DB-directly rule as every other bridge endpoint.

    This call blocks for as long as the CLI takes (up to CAS_AUTO_TIMEOUT_S)
    since the whole point is to report the real end-to-end outcome - the
    dashboard button shows a pending state for the duration rather than
    faking an immediate response.
    """
    try:
        result = subprocess.run(
            [sys.executable, "-m", "portfolio.cli", "cas", "auto", "--force"],
            capture_output=True,
            text=True,
            timeout=CAS_AUTO_TIMEOUT_S,
            cwd=ROOT_DIR,
        )
        if result.returncode != 0:
            logger.error("CAS auto failed: %s", result.stderr)
            return JSONResponse(
                status_code=502,
                content={"ok": False, "error": f"CAS auto failed: {result.stderr[-800:]}"},
            )
        return JSONResponse(content={"ok": True, "message": result.stdout.strip()[-800:]})
    except subprocess.TimeoutExpired:
        logger.error("CAS auto timed out")
        return JSONResponse(
            status_code=502,
            content={"ok": False, "error": f"cas auto timed out ({CAS_AUTO_TIMEOUT_S}s)"},
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("CAS auto failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


class CasScheduleUpdateRequest(BaseModel):
    """PUT body for the CAS request schedule - only provided fields change."""

    intervalDays: int | None = None
    enabled: bool | None = None


def _run_cas_schedule_cli(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "portfolio.cli", "cas", "schedule", *args],
        capture_output=True,
        text=True,
        timeout=15,
        cwd=ROOT_DIR,
    )


def _cas_schedule_response(result: subprocess.CompletedProcess) -> JSONResponse:
    if result.returncode != 0:
        logger.error("cas schedule CLI failed: %s", result.stderr)
        return JSONResponse(
            status_code=502,
            content={"ok": False, "error": f"cas schedule failed: {result.stderr[-500:]}"},
        )
    try:
        status = json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as exc:
        logger.error("cas schedule CLI returned unparseable output: %s", result.stdout)
        return JSONResponse(
            status_code=502,
            content={"ok": False, "error": f"cas schedule returned unparseable output: {exc}"},
        )
    return JSONResponse(content={"ok": True, **status})


@app.get("/api/cas/schedule")
async def cas_schedule_get() -> JSONResponse:
    """Read the CAS request schedule (docs/CAMS_KFINTECH_CAS_PLAN.md, Part C).
    Shells out to `portfolio cas schedule show`, same never-touch-the-DB-
    directly rule as every other bridge endpoint."""
    try:
        return _cas_schedule_response(_run_cas_schedule_cli(["show"]))
    except subprocess.TimeoutExpired:
        return JSONResponse(status_code=502, content={"ok": False, "error": "schedule read timed out (15s)"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("cas schedule read failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


@app.put("/api/cas/schedule")
async def cas_schedule_put(req: CasScheduleUpdateRequest) -> JSONResponse:
    """Update the CAS request schedule. 422 on a non-positive interval before
    any subprocess; shells out to `portfolio cas schedule set` otherwise."""
    if req.intervalDays is not None and req.intervalDays <= 0:
        return JSONResponse(
            status_code=422,
            content={"ok": False, "error": "intervalDays must be greater than 0"},
        )
    args: list[str] = []
    if req.intervalDays is not None:
        args += ["--interval-days", str(req.intervalDays)]
    if req.enabled is not None:
        args.append("--enabled" if req.enabled else "--disabled")
    if not args:
        return JSONResponse(
            status_code=422,
            content={"ok": False, "error": "provide intervalDays and/or enabled"},
        )
    try:
        return _cas_schedule_response(_run_cas_schedule_cli(["set", *args]))
    except subprocess.TimeoutExpired:
        return JSONResponse(status_code=502, content={"ok": False, "error": "schedule update timed out (15s)"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("cas schedule update failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})


@app.post("/api/agent/wake")
async def agent_wake() -> JSONResponse:
    """Wake the M7 agent on demand: spawn `opencode serve` detached when it
    is offline, otherwise report it already online.

    Returns 200 {ok, state} where state is "already-online" or "started", or
    a clean 502 {ok: false, error} - never a traceback. Does NOT wait for
    health: the UI's own health poll confirms the server; this endpoint only
    makes the spawn decision.
    """
    try:
        state = await ensure_agent_online()
    except AgentWakeError as exc:
        logger.error("agent wake failed: %s", exc)
        return JSONResponse(status_code=502, content={"ok": False, "error": str(exc)})
    except Exception as exc:  # noqa: BLE001 - clean 502, never a traceback
        logger.exception("agent wake failed")
        return JSONResponse(status_code=502, content={"ok": False, "error": f"{type(exc).__name__}: {exc}"})
    return JSONResponse(content={"ok": True, "state": state})


@app.post("/api/ask")
async def ask(payload: dict) -> JSONResponse:
    """Forward a question to the M7 agent; 503 with a clean error when the
    opencode server is not running."""
    question = str((payload or {}).get("question", "")).strip()
    if not question:
        return JSONResponse(status_code=400, content={"error": "question is required"})

    client = OpenCodeClient()
    if not await client.health():
        return JSONResponse(status_code=503, content={"error": "agent offline"})

    result = await client.ask(question)
    if result.error and not result.answered:
        return JSONResponse(status_code=502, content={"error": result.error})

    return JSONResponse(
        content={
            "answer": result.answer,
            "toolCalls": [
                {"tool": call.tool, "status": call.status} for call in result.tool_calls
            ],
            "turns": result.turns,
            "withinBudget": result.within_budget,
        }
    )


if __name__ == "__main__":
    import os

    import uvicorn

    # Loopback ONLY — the dashboard's local dev seam, never exposed.
    # Default 8001: another local project (Cardora) owns :8000 since 2026-09-01.
    # Override with PORTFOLIO_BRIDGE_PORT when needed.
    port = int(os.environ.get("PORTFOLIO_BRIDGE_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
