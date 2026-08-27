"""CAMS+KFintech CAS request automation.

See docs/CAMS_KFINTECH_CAS_PLAN.md for the full design. Summary: automates
the free, public "CAS - CAMS+KFintech" mailback form at
https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement
- no CAPTCHA, no login, verified live 2026-08-24 against production with a
real PAN. This module only triggers the mailback; the resulting email/PDF is
handled by cams_email_fetch.py (Part B) and the existing cas_import.py
(unchanged parse path).

Also owns the "is it due yet" schedule gate (Part C) - the scheduled task
fires often (e.g. daily), and this decides whether to actually act based on
the UI-configurable `cas_schedule` table, the same shape as the calendar gate
in calendars.py but gating on elapsed days instead of trading-day status.

No secrets are ever logged: pan and password never appear in a log line or
exception message.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

CAMS_CAS_URL = "https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement"

_SUCCESS_RE = re.compile(r"reference number is\s*([A-Za-z0-9]+)", re.IGNORECASE)

# Injectable for tests: takes (pan, email, password) -> confirmation panel text.
SubmitFn = Callable[[str, str, str], str]


class CamsRequestError(Exception):
    """A CAMS+KFintech CAS request could not be completed."""


def _dismiss_disclaimer_if_present(page: Any, *, timeout_ms: int = 5_000) -> None:
    """A fresh browser session (no prior consent cookie) shows a blocking
    "Disclaimer" modal (ACCEPT/DECLINE radios + a PROCEED button) before the
    form is usable. A real user's browser profile only sees this once; a
    fresh headless context sees it every run. Discovered live 2026-08-25
    (interactive testing missed it because that Chrome profile already had
    the consent from the user's own prior visits). No-ops quickly if the
    modal isn't present, so it's safe to always call.
    """
    try:
        page.get_by_text("Disclaimer", exact=True).wait_for(timeout=timeout_ms)
    except Exception:  # noqa: BLE001 - modal not shown; proceed normally
        return
    # Angular Material radio: the real <input> is cdk-visually-hidden (zero
    # size, off-screen) behind a styled label - neither a normal click nor a
    # force click can target it (no usable bounding box). Click the visible
    # label text instead, exactly like a real user selecting the radio via
    # its label - Angular Material wires the whole label to toggle the input.
    page.get_by_text("ACCEPT", exact=False).first.click()
    page.get_by_role("button", name="PROCEED").click()
    page.get_by_text("Disclaimer", exact=True).wait_for(state="hidden", timeout=timeout_ms)


def _dismiss_marketing_popups(page: Any, *, timeout_ms: int = 3_000) -> None:
    """The site also shows an unrelated marketing modal (e.g. "ASK Mutual
    Fund is now live!") in a mat-dialog that can appear after the disclaimer
    and cover the Submit button behind its cdk-overlay-backdrop - discovered
    live 2026-08-25. Its close control is `mat-icon.close-popup` (confirmed
    via live DOM inspection - Escape does NOT reliably close this dialog).
    Best-effort: never raises if no popup appears.
    """
    import contextlib

    with contextlib.suppress(Exception):
        page.locator("mat-icon.close-popup").first.click(timeout=timeout_ms)
        page.locator(".cdk-overlay-backdrop").wait_for(state="hidden", timeout=timeout_ms)


def _submit_via_playwright(pan: str, email: str, password: str) -> str:
    """Drive a real (headless) Chromium instance through the live-verified
    manual steps: leave Statement Type / As-On date / Folio Listing at their
    page defaults, fill Email/PAN/Password/Confirm Password, click Submit,
    return the confirmation panel's text content.

    Playwright's `fill()` dispatches proper input/change events itself (the
    native-setter trick used during interactive testing was only needed for
    ad-hoc DOM scripting, not needed here).
    """
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright

    try:
        with sync_playwright() as p:
            # Plain headless Chromium sets navigator.webdriver = true and
            # advertises "HeadlessChrome" in its UA string. CAMS's front-end
            # (an Akamai-style bot filter) fingerprints both and silently
            # rejects the submission with the same generic "unable to
            # process your request at this time" banner used for real rate-
            # limiting - indistinguishable from an actual rate limit without
            # digging in, and NOT time-based, so waiting doesn't help
            # (confirmed live 2026-08-27: identical request succeeded once
            # these signals were masked, immediately after a "rate-limited"
            # failure). Masking them is the fix, not a rate-limit workaround.
            browser = p.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"],
            )
            try:
                context = browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                    ),
                )
                context.add_init_script(
                    "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
                )
                page = context.new_page()
                page.goto(CAMS_CAS_URL, wait_until="domcontentloaded")
                _dismiss_disclaimer_if_present(page)
                page.get_by_placeholder("Email").fill(email)
                page.get_by_placeholder("PAN").fill(pan)
                page.get_by_placeholder("Password", exact=True).fill(password)
                page.get_by_placeholder("Confirm Password").fill(password)
                _dismiss_marketing_popups(page)
                page.get_by_role("button", name="Submit").click()
                # Race Success against the rate-limit toast rather than
                # waiting the full timeout for Success first: CAMS's "We are
                # unable to process your request at this time. Please try
                # again later." banner is a TRANSIENT toast that auto-
                # dismisses after a few seconds (confirmed live 2026-08-24) -
                # checking for it only after a 30s Success timeout means it
                # has usually already vanished, misreporting a rate-limit as
                # a generic "did not confirm success" failure. Whichever
                # phrase appears FIRST resolves this wait immediately.
                outcome = page.get_by_text(
                    re.compile(r"Success|unable to process your request", re.IGNORECASE)
                )
                try:
                    outcome.first.wait_for(timeout=30_000)
                except PlaywrightTimeoutError as exc:
                    raise CamsRequestError(f"CAMS form did not confirm success in time: {exc}") from exc
                text = page.inner_text("body")
                if "unable to process your request" in text.lower():
                    raise CamsRequestError(
                        "CAMS rejected the request (\"unable to process your "
                        "request at this time\") despite the automation-fingerprint "
                        "masking below - this banner is CAMS's generic bot/rate-limit "
                        "rejection and isn't time-based, so retrying immediately "
                        "won't help on its own; if this persists, CAMS may have "
                        "tightened its fingerprint checks further."
                    )
                return text
            finally:
                browser.close()
    except CamsRequestError:
        raise
    except Exception as exc:  # noqa: BLE001 - any Playwright/browser failure must surface
        raise CamsRequestError(f"CAMS form submission failed: {type(exc).__name__}: {exc}") from exc


def request_cams_kfintech_cas(
    *,
    pan: str | None,
    email: str | None,
    password: str | None,
    submit: SubmitFn | None = None,
) -> str:
    """Submit the CAMS+KFintech mailback form. Returns the reference number
    on success. Raises CamsRequestError on missing config, a submission
    failure, or an unexpected page state (no "Success" marker) - a changed
    page layout must fail loudly, never silently report success.
    """
    missing = [
        name
        for name, value in (("pan", pan), ("email", email), ("password", password))
        if not value
    ]
    if missing:
        raise CamsRequestError(
            f"CAMS request not configured - missing: {', '.join(missing)} "
            "(run `portfolio auth --platform cams`)"
        )

    submitter = submit or _submit_via_playwright
    text = submitter(pan, email, password)

    if "success" not in text.lower():
        raise CamsRequestError(f"CAMS form did not confirm success: {text[:300]!r}")

    match = _SUCCESS_RE.search(text)
    if not match:
        raise CamsRequestError(
            f"CAMS form reported success but no reference number was found: {text[:300]!r}"
        )
    return match.group(1)


def is_cas_request_due(conn: Any, *, at: datetime) -> tuple[bool, str]:
    """Return (due, reason). Reads cas_schedule.{interval_days,enabled} and
    the most recent successful platform='cams' `runs` row.

    Pure given its inputs (like calendars.gate_check): never reads the clock
    itself, naive datetimes refused loudly.
    """
    if at.tzinfo is None:
        raise ValueError("is_cas_request_due requires a timezone-aware datetime")

    row = conn.execute("SELECT interval_days, enabled FROM cas_schedule WHERE id = 1").fetchone()
    if row is None:
        return False, "cas_schedule not configured"
    interval_days, enabled = row["interval_days"], row["enabled"]
    if not enabled:
        return False, "disabled"

    last = conn.execute(
        "SELECT started_at FROM runs WHERE platform = 'cams' AND status = 'ok' "
        "ORDER BY started_at DESC LIMIT 1"
    ).fetchone()
    if last is None:
        return True, "no prior successful request"

    last_at = datetime.fromisoformat(last["started_at"])
    elapsed_days = (at - last_at).total_seconds() / 86400
    if elapsed_days >= interval_days:
        return True, f"{elapsed_days:.1f}d elapsed >= {interval_days}d interval"
    return False, f"{elapsed_days:.1f}d elapsed < {interval_days}d interval"


def schedule_status(conn: Any, *, at: datetime) -> dict[str, Any]:
    """Read-only snapshot of the schedule for the UI/bridge (Part C):
    current settings, the last successful request time, and when the next
    one is due. Wraps is_cas_request_due rather than duplicating its logic.
    """
    if at.tzinfo is None:
        raise ValueError("schedule_status requires a timezone-aware datetime")

    row = conn.execute("SELECT interval_days, enabled FROM cas_schedule WHERE id = 1").fetchone()
    interval_days = row["interval_days"] if row else None
    enabled = bool(row["enabled"]) if row else False

    last = conn.execute(
        "SELECT started_at FROM runs WHERE platform = 'cams' AND status = 'ok' "
        "ORDER BY started_at DESC LIMIT 1"
    ).fetchone()
    last_at = last["started_at"] if last else None

    next_due_at = None
    if last_at and interval_days:
        next_due_at = (datetime.fromisoformat(last_at) + timedelta(days=interval_days)).isoformat()

    due, reason = is_cas_request_due(conn, at=at)
    return {
        "intervalDays": interval_days,
        "enabled": enabled,
        "lastRequestedAt": last_at,
        "nextDueAt": next_due_at,
        "due": due,
        "reason": reason,
    }


def set_schedule(
    conn: Any, *, interval_days: int | None = None, enabled: bool | None = None
) -> None:
    """Update only the provided fields of the singleton cas_schedule row."""
    if interval_days is not None:
        if interval_days <= 0:
            raise ValueError("interval_days must be > 0")
        conn.execute("UPDATE cas_schedule SET interval_days = ? WHERE id = 1", (interval_days,))
    if enabled is not None:
        conn.execute("UPDATE cas_schedule SET enabled = ? WHERE id = 1", (int(enabled),))
    conn.commit()
