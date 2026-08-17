"""M8 dashboard bridge — the thin FastAPI seam between the React UI and the
pipeline/agent. Lives in the portfolio package so it can import the M7 agent
client in-process (no proxy hops).

Three endpoints, one job:

    GET  /api/health   -> {pipeline: {asOf, exportsPresent}, agent: bool}
    POST /api/refresh  -> {ok: true, summary} | 502 {ok: false, error}
    POST /api/ask      -> {answer, toolCalls, turns, withinBudget} | 503

Guardrails:
    - Binds loopback only when served (127.0.0.1:8000 — uvicorn flag, and the
      __main__ entry below hard-codes it).
    - CORS allows the Vite dev origin; the dev proxy means the browser talks
      to the same origin anyway (CORS is belt-and-suspenders).
    - NEVER touches broker MCPs or the DB directly: refresh shells out to the
      real pipeline CLI (snapshot --all --force + export_json.py), exactly the
      scheduled path. Determinism boundary holds: the LLM only enters through
      /api/ask -> OpenCodeClient (M7).
    - No secrets: no tokens are read or echoed here. Agent auth comes from
      OPENCODE_SERVER_PASSWORD via the M7 client's own env handling.
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from portfolio.agent.client import OpenCodeClient
from portfolio.config import ROOT_DIR

logger = logging.getLogger("portfolio.bridge")

app = FastAPI(title="portfolio-dashboard-bridge", version="0.1.0")

# The Vite dev server origin(s) the SPA is served from. /api/* is proxied by
# Vite, so these matter only for direct cross-origin calls to :8000.
CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Pipeline refresh subprocess budgets: the snapshot leg pulls live brokers
# (daemon RPC + OpenD) and can take minutes; the export is a quick DB read.
REFRESH_TIMEOUT_S = 900
EXPORT_TIMEOUT_S = 120

DATA_DIR = ROOT_DIR / "dashboard" / "public" / "data"


def _latest_as_of() -> str | None:
    """asOf from the exported latest.json ('' -> None when unreadable)."""
    try:
        payload = json.loads((DATA_DIR / "latest.json").read_text(encoding="utf-8"))
        return payload.get("asOf")
    except (OSError, ValueError):
        return None


def _exports_present() -> bool:
    return all((DATA_DIR / f).is_file() for f in ("latest.json", "history.json", "alerts.json", "xirr.json"))


@app.get("/api/health")
async def health() -> dict:
    """Pipeline freshness (export files) + agent reachability (M7 client)."""
    agent = await OpenCodeClient().health()
    return {
        "pipeline": {"asOf": _latest_as_of(), "exportsPresent": _exports_present()},
        "agent": agent,
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
    import uvicorn

    # Loopback ONLY — the dashboard's local dev seam, never exposed.
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")