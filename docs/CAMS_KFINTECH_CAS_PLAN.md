# Automated CAS Request + Auto-Import — CAMS+KFintech Direct

Status: **IMPLEMENTED AND LIVE (2026-08-24).** This document was originally a
pre-implementation plan; it has been rewritten as an as-built reference now
that the feature is running in production. If you're a future agent picking
this up, read this whole doc before touching any of the files listed in §9 —
several non-obvious bugs were found and fixed during implementation (§8),
and repeating them wastes real-world test cycles against a live third-party
system with rate limiting.

Supersedes the earlier `docs/CAS_GENERATOR_PLAN.md` (deleted — it was built
around casparser.in's paid API, which turned out to require a ₹3,500/mo
subscription for the endpoint needed, confirmed via the user's live account,
not just their public docs).

---

## 1. What this feature does (read this first)

Groww has no official API returning mutual fund holdings, so the only path
to that data is the SEBI-mandated **Consolidated Account Statement (CAS)** —
previously imported **manually, once a month**, by downloading an emailed
PDF and uploading it to the dashboard.

This feature automates that entire loop for the **Groww folio mutual funds**
slice of the data (not demat holdings, not equities — see §1.1):

```
Every N days (default 2, UI-configurable) →
  1. A headless browser submits CAMS's own free public "CAS - CAMS+KFintech"
     form (no CAPTCHA, no login) → CAMS emails a fresh statement
  2. A Gmail API poll detects that email and downloads the PDF attachment
  3. The EXISTING (unchanged) casparser-based import path parses it and
     writes holdings to the DB
  4. Dashboard JSON exports regenerate
  5. A Telegram message reports success or exactly which step failed
```

Also runs on-demand from the dashboard (two buttons: "Request Fresh CAS" for
step 1 only, "Run Full Auto-Import" for all 5 steps), from the CLI
(`portfolio cas request` / `portfolio cas auto`), and daily via a Windows
Scheduled Task (`PortfolioCasAuto`, 21:40 IST, self-gates on the schedule so
it's a no-op on days it isn't due).

### 1.1 Scope limit — read this before assuming it does more than it does

The CAMS+KFintech combined form's own disclaimer: *"The statements may not
reflect the complete information on your DEMAT holdings which is basis last
available details received from depositories."* This is a **CAMS/KFintech
RTA-only statement** — it has NO `accounts`/demat section at all (see §8.3
for the parsing consequence this had). It only ever refreshes **Groww folio
mutual funds**. Demat holdings and equities still require the existing
monthly manual NSDL/CDSL-issued CAS import — this feature does not touch
that path and never will under the current design.

---

## 2. Architecture

```
Dashboard "Request Fresh CAS" ──► POST /api/cas/request ──► `portfolio cas request --force`
Dashboard "Run Full Auto-Import" ─► POST /api/cas/auto ───► `portfolio cas auto --force`
Scheduled Task (daily 21:40 IST) ────────────────────────► `portfolio cas auto` (self-gated)

`portfolio cas auto`:
  ┌─ is_cas_request_due(conn, at) ── reads cas_schedule table + last `runs` row
  │    not due → write_skipped, exit 0
  │    due ↓
  ├─ request_cams_kfintech_cas(pan, email, password)   [cams_cas_request.py]
  │    → Playwright headless Chromium → camsonline.com form → reference number
  │    → runs row: platform='cams'
  ├─ find_and_download_cas_pdf(gmail_service, since)   [cams_email_fetch.py]
  │    → Gmail API search + download → local PDF path
  │    → runs row: platform='cams_fetch'
  ├─ import_cas(pdf_path, password)                    [cas_import.py, UNCHANGED]
  │    → casparser parse → Holding rows → DB (same path as manual upload)
  ├─ export_json.py subprocess                         → dashboard/public/data/*.json
  └─ send_telegram(...)                                [alerts/telegram.py, UNCHANGED]
```

Credentials/config, all read via `portfolio.tokens.store` or `.env`:
- CAMS (PAN, registered email, CAS PDF password) → `data/tokens.json["cams"]`
- Gmail OAuth (client id/secret, access+refresh token) → `data/tokens.json["gmail"]`
- Telegram (bot token, chat id) → `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
- Schedule (interval days, enabled) → SQLite `cas_schedule` table (singleton row, id=1)

---

## 3. Part A — CAMS+KFintech request automation

**File: `src/portfolio/cams_cas_request.py`**

```python
class CamsRequestError(Exception): ...

def request_cams_kfintech_cas(*, pan, email, password, submit=None) -> str:
    """Returns the reference number on success. `submit` is injectable for
    tests (defaults to _submit_via_playwright)."""

def is_cas_request_due(conn, *, at: datetime) -> tuple[bool, str]:
    """Schedule gate - reads cas_schedule + last successful 'cams' runs row."""

def schedule_status(conn, *, at: datetime) -> dict:
    """Read-only snapshot for the UI: interval, enabled, last/next due."""

def set_schedule(conn, *, interval_days=None, enabled=None) -> None:
    """Updates the singleton cas_schedule row."""
```

**Live-verified against the real production form** (not a sandbox):
`https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement`
defaults to the "CAS - CAMS+KFintech" tab. Fields: Statement Type (leave at
default "Summary" — see §8.3 for why this matters), As-On date (auto-fills,
leave untouched), Folio Listing (leave at default "Without zero balance
folios"), Email/PAN/Password/Confirm Password (fill), Submit button.
Playwright's `page.fill()` is used (not raw JS `.value=`, which does not
register on this React-controlled form).

On success the page shows a panel containing "Success" and "Your reference
number is `<REF>`" — parsed via `_SUCCESS_RE`. **No CAPTCHA** is present
(confirmed by inspecting every `<script>`/`<iframe>` on the page for
recaptcha/turnstile/hcaptcha patterns — zero matches) — this is what makes
full automation possible without a human-in-the-loop step.

`is_cas_request_due`/`schedule_status`/`set_schedule` back the UI-configurable
schedule (Part C, §5).

---

## 4. Part B — Gmail auto-fetch + auto-import

### 4.1 One-time user setup (cannot be scripted by an agent)

1. Google Cloud Console → new/existing project → enable **Gmail API**.
2. OAuth consent screen → User type **External** → fill app name/support
   email → add the user's own Gmail address as a **Test user** (required;
   the app stays in "Testing" mode forever for personal use, no Google
   review needed) → the newer console UI also has a separate **Branding**
   page (App domain/homepage/privacy/ToS/authorised domains) that can be
   left **entirely blank** for a testing-only app — it still saves.
3. Credentials → **Create Credentials → OAuth client ID** → type **Desktop
   app** → gives a client ID + client secret.
4. `portfolio auth --platform gmail` → prompts for those two values → runs
   the consent flow (opens a browser, user approves) → stores the resulting
   token.

**Security note already surfaced to the user before consent (keep doing
this for any future re-setup):** Gmail's API has no "read only CAS emails"
scope — `gmail.readonly` grants read access to the *entire* mailbox. Token
lives in `data/tokens.json["gmail"]`, never logged, revocable anytime from
the user's Google Account permissions page.

### 4.2 `src/portfolio/tokens/gmail_oauth.py`

```python
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

def run_consent_flow(*, client_id: str, client_secret: str) -> None: ...
def load_credentials() -> Credentials:
    """Loads + auto-refreshes stored creds. Raises GmailAuthError if never
    configured or refresh fails."""
def build_gmail_service() -> object:
    """Returns an authenticated googleapiclient Gmail resource."""
```

Uses `google-auth-oauthlib`'s `InstalledAppFlow.run_local_server()`, which
handles the entire loopback-redirect dance itself — no hand-rolled callback
server needed (unlike `tokens/moomoo_oauth.py`'s MCP-specific flow, which
doesn't apply here since Google's OAuth needs a manually-created Desktop
client, not dynamic client registration).

**Gotcha (see §8.7 for the full story):** `InstalledAppFlow.run_local_server`
opening a real browser via `webbrowser.open()` does not reliably work from
an automated/sandboxed shell context — if scripting this flow non-
interactively, use `open_browser=False` and relay the printed authorization
URL to the human instead of trusting auto-open.

### 4.3 `src/portfolio/cams_email_fetch.py`

```python
CAMS_SENDER = "donotreply@camsonline.com"
CAMS_SUBJECT = "Consolidated Account Statement - CAMS Mailback Request"  # exact match

class CamsEmailNotFoundError(Exception): ...

def find_and_download_cas_pdf(
    *, gmail_service, since: datetime, dest_dir: Path,
    timeout_seconds=600, poll_interval_seconds=30,
    sleep=time.sleep, now=time.monotonic,
) -> Path:
    """Polls Gmail, downloads the PDF attachment, returns its path."""
```

**Confirmed live via the Gmail MCP connector** (an interactive-Claude-only
tool — see the caveat below) against real received emails: sender, exact
subject, and attachment filename pattern
`{maskedPAN}_{fromDate}-{toDate}_{referenceNumber}_{timestamp}.pdf` (e.g.
`CJXXXXXX3F_26052026-24082026_CP221891492_24082026090639775.pdf`).
**Attachment `mimeType` is `application/octet-stream`, NOT `application/pdf`**
— the code filters by filename suffix, never by MIME type.

**Critical correctness detail (§8.5 has the full bug story):**
`_find_message_id` does NOT trust "newest result from a day-granularity
`after:` query" alone — Gmail's `after:` filter is date-only, so on a day
with multiple CAS emails (normal during testing, and could recur if a user
manually requests one between scheduled runs) the newest *query match* can
be an email that predates *this specific request*. The function fetches
each candidate's actual `internalDate` (epoch ms) via a `format=metadata`
call and only accepts it if `internalDate >= since_ms`; otherwise it keeps
polling. Gmail returns results newest-first, so checking only the single
newest match is sufficient (if it's too old, nothing further back could
qualify either).

Note on the Gmail MCP connector used to discover the sender/subject/filename
facts above: `mcp__claude_ai_Gmail__*` tools are only available inside an
interactive Claude session (via the user's claude.ai account) — they CANNOT
be used by the unattended scheduled task, which runs standalone via Windows
Task Scheduler with zero Claude involvement. The production path uses only
the Google Cloud OAuth client + `google-api-python-client`, independent of
Claude entirely.

### 4.4 Orchestration — `portfolio cas auto` (`cli.py`)

Full loop, each step audited **separately** in `runs` (not collapsed into
one row, so "request succeeded but email never arrived" is distinguishable
from "request itself failed"):
1. Schedule gate check (skip → `write_skipped`, platform=`cams`, exit 0)
2. `request_cams_kfintech_cas` → `runs` row platform=`cams`
3. `find_and_download_cas_pdf` → `runs` row platform=`cams_fetch`. On
   `CamsEmailNotFoundError`/`GmailAuthError`: Telegram alert pointing at the
   manual fallback (upload via the CAS Import screen), exit 1 — never a
   silent false success.
4. `import_cas()` (existing, unchanged) on the downloaded PDF
5. `scripts/export_json.py` subprocess
6. Telegram summary (best-effort — missing config never fails the run)

---

## 5. Part C — UI-configurable schedule

### 5.1 Why not a Task Scheduler interval directly

Changing a `<DaysInterval>` needs re-registering the task. Instead the
scheduled task fires **daily**, and `portfolio cas auto`/`cas request`
decide internally whether they're actually due, via `is_cas_request_due`
reading the `cas_schedule` table — same shape as the existing
`calendars.gate_check` trading-day gate, just gating on elapsed days.

### 5.2 DB — migration `0012_cas_schedule.sql`

```sql
CREATE TABLE IF NOT EXISTS cas_schedule (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    interval_days INTEGER NOT NULL DEFAULT 2 CHECK (interval_days > 0),
    enabled INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO cas_schedule (id, interval_days, enabled) VALUES (1, 2, 1);
```

Default **every 2 days** (user's explicit choice). No market-hours gating —
CAS/MF folio data isn't intraday; it only changes when the user transacts.

### 5.3 CLI — `portfolio cas schedule show` / `set`

Both print one JSON line (`schedule_status()`'s dict) — this is the contract
the bridge parses, deliberately not human-formatted text (unlike most other
CLI output in this repo), to avoid fragile regex parsing on the bridge side.

### 5.4 Bridge endpoints (`bridge.py`)

```
GET  /api/cas/schedule -> {ok, intervalDays, enabled, lastRequestedAt, nextDueAt, due, reason}
PUT  /api/cas/schedule -> same shape, body: {intervalDays?, enabled?} -> 422 if neither given or interval <= 0
POST /api/cas/request  -> {ok, message} | 502   (shells `cas request --force`, 60s timeout)
POST /api/cas/auto     -> {ok, message} | 502   (shells `cas auto --force`, 700s timeout - the
                                                  email wait alone can take up to 600s)
```
All shell out to the CLI (never touch camsonline.com/Gmail/the DB directly
from the bridge process — same hard rule as every other endpoint in this
file). GET/PUT parse the CLI's one-line JSON stdout via `_cas_schedule_response`.

### 5.5 Dashboard UI — `CasImportScreen.tsx`

Now has, top to bottom: an "About the CAS" alert (updated copy explaining
the split between this automated folio-MF leg and the still-manual full
monthly CAS), a `CasScheduleCard` component with:
- **"Request Fresh CAS"** button → `requestCas()` → inline `<Alert>` success/error
- **"Run Full Auto-Import"** button → `runCasAuto()` → **toast** (sonner)
  success/error on completion (can take up to ~10 min; button shows a
  pending spinner the whole time) + invalidates all dashboard TanStack
  Query caches on success
- Schedule controls: editable interval-days input + Save button, an
  Enabled/Disabled toggle, "last requested"/"next due" readout, all wired to
  `useCasSchedule()`/`updateCasSchedule()` in `dashboard/src/lib/data.ts`
- The original manual PDF-upload card, unchanged

`sonner`'s `<Toaster />` had to be mounted in `App.tsx` as part of this work
— see §8.6, it was never mounted anywhere before and every existing
`toast()` call in the codebase was silently a no-op.

---

## 6. What the user must configure (all done as of 2026-08-24, listed for reference/re-setup)

1. `portfolio auth --platform cams` → PAN, registered email, CAS PDF
   password → `data/tokens.json["cams"]`.
2. Google Cloud OAuth Desktop client (§4.1) + `portfolio auth --platform
   gmail` → `data/tokens.json["gmail"]`.
3. Telegram bot via @BotFather + chat id → `TELEGRAM_BOT_TOKEN`/
   `TELEGRAM_CHAT_ID` in `.env` (see §8.8 — must be `.env`, not just an
   OS-level env var, or it becomes fragile depending on which process
   started which).

---

## 7. How to test / troubleshoot

```powershell
# Check current schedule state
uv run python -m portfolio.cli cas schedule show

# Force a request only (bypasses the 2-day gate)
uv run python -m portfolio.cli cas request --force

# Force the full loop (request -> email -> download -> import -> export)
uv run python -m portfolio.cli cas auto --force

# Inspect recent runs for this feature
uv run python -c "
from portfolio.db import connect
conn = connect('data/portfolio.db')
for r in conn.execute(\"SELECT platform, status, error, started_at FROM runs WHERE platform IN ('cams','cams_fetch') ORDER BY id DESC LIMIT 10\"):
    print(dict(r))
"

# Scheduled task status
powershell -ExecutionPolicy Bypass -File scripts\scheduler\list_tasks.ps1

# Gmail token broken (invalid_grant) -> re-consent, then re-verify
uv run portfolio auth --platform gmail
uv run python -m portfolio.cli cas auto --force
```

**IMPORTANT — do not spam live tests.** Every `cas request`/`cas auto`
invocation hits the real production CAMS system and sends a real email.
CAMS applies server-side rate limiting after repeated same-day requests
(§8.4) — space out live tests, prefer the injectable-fake unit tests in
`tests/test_cams_cas_request.py` and `tests/test_cams_email_fetch.py` for
anything that doesn't specifically need to hit the real site.

---

## 8. Bugs found and fixed during implementation (read before touching this code again)

These were all discovered via real live testing, not caught by unit tests
alone — several of them specifically because the injectable-fake tests
necessarily can't model live third-party page/API quirks. Each has a
regression test where practical; the ones that don't (Playwright page
interactions) are documented here instead.

### 8.1 Disclaimer modal on a fresh browser session
A brand-new Playwright/headless Chromium session (no prior consent cookie)
sees a blocking "Disclaimer" modal (Accept/Decline radios + Proceed button)
that a real user's browser only sees once. `_dismiss_disclaimer_if_present`
handles this — no-ops quickly if absent.

**Sub-gotcha:** the radio buttons are Angular Material components — the
real `<input>` is `cdk-visually-hidden` (zero size, off-screen), so neither
a normal Playwright click nor `force=True` click can target it (no usable
bounding box). Click the **visible label text** instead ("ACCEPT"), exactly
like a real user clicking the label.

### 8.2 Unrelated marketing popup covering the Submit button
A separate promotional modal (seen: "ASK Mutual Fund is now live!") can
appear mid-flow, sitting in a `mat-dialog-container` behind a
`cdk-overlay-backdrop` that intercepts clicks on the real form underneath.
`Escape` does **not** reliably close it. The actual close control, found by
inspecting the live DOM: `mat-icon.close-popup`. `_dismiss_marketing_popups`
clicks that directly.

### 8.3 Two different CAS document shapes from casparser
The CAMS+KFintech RTA-only form's PDF, when parsed by `casparser`, returns a
flat `folios` list with **no `accounts` key at all** — a genuinely different
Pydantic model shape than the depository-issued (NSDL/CDSL) CAS that
`cas_import.py`'s `extract_holdings()` was originally built for (which
expects `accounts[].{equities,mutual_funds}`). The bug manifested as
"CAS yielded no importable holdings" despite `casparser` correctly parsing
14 real folios. Fixed by having `extract_holdings()` detect which shape it's
looking at (`raw.get("accounts")` vs `raw.get("folios")`) and dispatch to a
new `_extract_folios_summary()`/`_folio_mf_holding()` path for the latter.
**Bonus finding:** this document type actually reports a real cost basis for
every scheme (including demat-held ones), better data quality than the old
depository CAS's demat-MF value-only rows.

### 8.4 CAMS rate-limits repeated same-day requests
After enough live testing in one session, CAMS starts returning a red toast:
*"We are unable to process your request at this time. Please try again
later."* This is normal/expected under test load, not a bug — but it was
initially misdetected:

**8.4a — detected as a generic timeout instead of the specific rate-limit
message.** First fix attempt checked the page body for the rate-limit phrase
only *after* the 30s "Success" wait had already timed out. The toast is
**transient and auto-dismisses after a few seconds** — by the time the code
looked, it had usually already vanished. Fixed by racing a single combined
locator (`page.get_by_text(re.compile(r"Success|unable to process your request", re.I))`)
so whichever appears **first** resolves the wait immediately, catching the
toast while still visible.

### 8.5 Stale email accepted instead of waiting for the fresh one
See §4.3 above — `_find_message_id` originally trusted "first/newest result
from the day-level query" without checking the actual message timestamp. In
a real `cas auto` run this caused it to import an *older* email already
sitting in the inbox from an earlier same-day manual request, instead of
waiting ~90s for the genuinely new one it had just triggered. Fixed with the
`internalDate >= since_ms` check; regression test:
`test_rejects_stale_email_and_keeps_polling_for_a_newer_one`.

### 8.6 sonner's Toaster was never mounted
Pre-existing gap, unrelated to this feature but discovered while building
its UI: `toast()` calls (already present in `GoalMilestones.tsx`) were
silently doing nothing anywhere in the app, because `<Toaster />` was never
rendered. Fixed by mounting it in `App.tsx`, theme-aware via the existing
`useTheme()` hook.

### 8.7 Environment variable inheritance is fragile across process trees
Setting `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` via
`[Environment]::SetEnvironmentVariable(...,'User')` (persisted at the
Windows registry level) does **not** retroactively appear in any
already-running shell session's `$env:`/`os.environ`, nor in any child
process spawned from such a stale session (e.g. the bridge launched via
`Start-Process` from an agent's long-lived tool session) — only genuinely
fresh top-level processes (a new terminal, Task Scheduler firing) see it.
This caused real, confusing "Telegram not configured" failures even though
the registry value was correct. **Permanent fix: real `.env` file loading**
(§8.8) — every process reads fresh from disk at its own startup, sidestepping
the whole inheritance-timing problem.

### 8.8 `.env` loading regression: relative `PORTFOLIO_DB_PATH` broke Task Scheduler
Adding `load_dotenv()` to `config.py` (to fix §8.7) and then writing a real
`.env` containing `PORTFOLIO_DB_PATH=data/portfolio.db` (copied verbatim
from `.env.example`'s relative-path convention) broke the next scheduled
`PortfolioSnapshotEod`/`PortfolioTrades` runs: `OperationalError: unable to
open database file` / `[WinError 5] Access is denied: 'data'`. Root cause:
that variable had never actually been *set* anywhere before, so the code
always fell back to its own absolute default
(`DATA_DIR / "portfolio.db"`). Once `.env` set it for real, `Path("data/
portfolio.db")` resolved relative to **whatever cwd the calling process
happened to have** — fine for an interactive shell at the repo root, but the
Task Scheduler `.cmd` wrappers never `cd` into the repo before invoking
python, so it resolved to a nonsense, permission-denied path.

**Fixed two ways** in `config.py`:
```python
_db_path_env = os.getenv("PORTFOLIO_DB_PATH")
DB_PATH = (ROOT_DIR / _db_path_env) if _db_path_env else (DATA_DIR / "portfolio.db")
```
(`ROOT_DIR / x` is a no-op when `x` is already absolute, so this is safe
either way) — **and** the actual `.env` file no longer sets
`PORTFOLIO_DB_PATH` at all, since the code's own absolute default is exactly
what every process should use. `.env.example`'s comment was updated to
explain why it's deliberately left blank.

**Lesson for future agents:** any time you add a new `.env`-sourced setting
that's a filesystem path, verify it resolves correctly from a *different*
working directory than the repo root before considering the change safe —
this class of bug is invisible when you only ever test from an interactive
shell already sitting at the repo root.

### 8.9 Google OAuth refresh token dies every ~7 days ("Testing" publishing status)
First failure observed 2026-09-01 in the 21:40 IST `PortfolioCasAuto` task:
the Gmail fetch step died with `RefreshError: invalid_grant: Token has been
expired or revoked` while refreshing the stored access token. Root cause:
the Google Cloud OAuth client was created with the consent screen in
Google's default **Testing** publishing status, and Google hard-invalidates
testing-mode refresh tokens after **7 days** for unverified apps (M8.10 went
live 2026-08-24 — the first failure landed on day 8, matching the rule
exactly). Other possible `invalid_grant` causes (user revoked the grant, a
newer consent overwrote the stored token) were checked and don't fit the
timing; the stored token entry itself was structurally fine.

**Recovery (manual by design — guardrail #3):**
```powershell
uv run portfolio auth --platform gmail   # re-consent -> fresh refresh token
```
then re-verify the loop with `cas auto --force`.

**Permanent fix:** Google Cloud Console → OAuth consent screen → change
publishing status **Testing → In production**. Published (verified or not)
refresh tokens do not carry the 7-day expiry; re-consent once after
publishing.

**Lesson for future agents:** an OAuth client that must survive unattended
scheduled runs must never remain in Testing status — publish the consent
screen at setup time, and treat a class of token-expiry failure as a
first-run checklist item, not a surprise a week later.

---

## 9. Files touched (final, as-built — supersedes any earlier "planned" list)

- `pyproject.toml` — `playwright`, `google-api-python-client`,
  `google-auth-oauthlib`, `google-auth-httplib2`, `python-dotenv`
- `src/portfolio/config.py` — `load_dotenv()` call; `DB_PATH` resolution
  fix (§8.8)
- `src/portfolio/cams_cas_request.py` — **new**: request automation +
  schedule gate/status/set
- `src/portfolio/cams_email_fetch.py` — **new**: Gmail search + download
- `src/portfolio/tokens/gmail_oauth.py` — **new**: Gmail OAuth consent +
  token refresh
- `src/portfolio/cas_import.py` — `extract_holdings()` dispatch for the
  `folios` document shape (§8.3); new `_extract_folios_summary()`,
  `_folio_mf_holding()`
- `src/portfolio/cli.py` — `auth --platform cams|gmail`; `cas request`,
  `cas auto`, `cas schedule show`/`set` commands
- `src/portfolio/db/migrations/0012_cas_schedule.sql` — **new**
- `src/portfolio/bridge.py` — `POST /api/cas/request`, `POST /api/cas/auto`,
  `GET/PUT /api/cas/schedule`
- `.env` / `.env.example` — Telegram credentials; `PORTFOLIO_DB_PATH`
  deliberately absent (§8.8)
- `dashboard/src/lib/data.ts` — `requestCas()`, `runCasAuto()`,
  `getCasSchedule()`, `updateCasSchedule()`, `useCasSchedule()`
- `dashboard/src/lib/workspaces.ts` — added `'cas'` workspace (the CAS
  Import screen existed as a component but was never wired into navigation
  before this session — unrelated pre-existing gap, fixed in passing)
- `dashboard/src/components/shell/WorkspaceCenter.tsx` — renders
  `CasImportScreen` for the `'cas'` workspace
- `dashboard/src/components/cas/CasImportScreen.tsx` — schedule card,
  request/auto-import buttons, toast wiring
- `dashboard/src/App.tsx` — mounted `<Toaster />` (§8.6)
- `scripts/scheduler/run_cas_auto.cmd` — **new** wrapper
- `scripts/scheduler/register_tasks.ps1` / `unregister_tasks.ps1` /
  `list_tasks.ps1` — `PortfolioCasAuto` task, 21:40 IST daily
- `samples/cas/cas_folios_summary_scrubbed.json` — **new** fixture for the
  folios-shape parsing (§8.3)
- `tests/test_cams_cas_request.py`, `tests/test_cams_email_fetch.py` —
  **new**
- `tests/test_cas_import.py` — folios-shape dispatch tests
- `tests/test_migrate.py`, `tests/test_goals.py`, `tests/test_performance.py`
  — schema-version assertions bumped for migration 0012

---

## 10. Explicitly out of scope (unchanged from the original plan)

- Any change to how demat holdings / equities refresh — those stay on the
  existing monthly manual CAS import indefinitely.
- Tightening the interval below every 2 days, or adding market-hours logic
  — not meaningful for this data (see §5.2).
- A general-purpose "settings" UI beyond the CAS schedule control.
