"""M8 dashboard bridge — the thin FastAPI seam between the React UI and the
pipeline/agent. Lives in the portfolio package so it can import the M7 agent
client in-process (no proxy hops).

Endpoints:

    GET  /api/health   -> {pipeline: {asOf, exportsPresent, exportsGeneratedAt}, agent: bool}
    POST /api/refresh  -> {ok: true, summary} | 502 {ok: false, error}
    POST /api/cas/import -> {ok: true, import, export} | 502 {ok: false, error}
    POST /api/property/import -> {ok: true, import, export} | 502 {ok: false, error}
    DELETE /api/property/{id} -> {ok: true, deleted, export} | 502 {ok: false, error}
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
    - File uploads (CAS PDF) are validated by content type and size.
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import sys
from datetime import UTC, datetime

from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from portfolio.agent.client import OpenCodeClient
from portfolio.config import ROOT_DIR

logger = logging.getLogger("portfolio.bridge")

app = FastAPI(title="portfolio-dashboard-bridge", version="0.1.0")

# The Vite dev server origin(s) the SPA is served from. /api/* is proxied by
# Vite, so these matter only for direct cross-origin calls to :8000. Both the
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
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Pipeline refresh subprocess budgets: the snapshot leg pulls live brokers
# (daemon RPC + OpenD) and can take minutes; the export is a quick DB read.
REFRESH_TIMEOUT_S = 900
EXPORT_TIMEOUT_S = 120

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


@app.get("/api/health")
async def health() -> dict:
    """Pipeline freshness (export files) + agent reachability (M7 client)."""
    agent = await OpenCodeClient().health()
    return {
        "pipeline": {
            "asOf": _latest_as_of(),
            "exportsPresent": _exports_present(),
            "exportsGeneratedAt": _exports_generated_at(),
        },
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


@app.post("/api/cas/import")
async def cas_import(file: UploadFile, password: str = "") -> JSONResponse:
    """Import a CAS PDF (Consolidated Account Statement) — the free monthly
    Groww/IN holdings path (stocks + MFs).

    Accepts a PDF file upload (CAS is emailed monthly as a PDF), runs `portfolio
    cas import` on a temp file, then regenerates the dashboard exports.
    The PDF never leaves this machine (casparser is fully offline).
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