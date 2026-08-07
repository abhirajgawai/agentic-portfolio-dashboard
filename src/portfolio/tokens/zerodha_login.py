"""Zerodha daily MANUAL browser login flow.

Guardrail #3 (no automated login): we never automate the browser or 2FA. We
connect, ask the server for the authorization URL, open it in the user's browser,
and WAIT (polling get_profile) until the user completes login. If they don't within
`timeout`, we raise and the daemon notifies via Telegram instead of failing silently.
"""

from __future__ import annotations

import asyncio
import logging
import re
import sys
import webbrowser
from dataclasses import dataclass
from datetime import UTC

from portfolio.alerts.telegram import send_snapshot_expiry_warning
from portfolio.clients.zerodha import ZerodhaMCPClient, extract_login_url
from portfolio.config import Settings
from portfolio.tokens.store import set_platform_value

logger = logging.getLogger("portfolio.tokens.zerodha_login")

# MINOR-1: the authorize URL carries the session_id - a login capability. The
# user needs the FULL url on an interactive console, but the daemon's detached
# stdout is a log file, so anything printed there is stripped of session_id.
_SESSION_ID = re.compile(r"(session_id=)[^\s&\"']+")


def _strip_session_id(text: str) -> str:
    """Redact the session_id query param from a login URL / raw payload."""
    return _SESSION_ID.sub(r"\1[REDACTED]", text)


@dataclass
class LoginOutcome:
    ok: bool
    detail: str
    login_url: str | None = None


class SessionLoginTimeout(Exception):
    """User did not complete the browser login within the allowed window."""


async def ensure_authenticated(
    client: ZerodhaMCPClient,
    *,
    open_browser: bool = True,
    poll_interval: float = 5.0,
    timeout_seconds: float = 300.0,
) -> LoginOutcome:
    """Return an authenticated client (login flow if needed).

    If already authenticated, returns immediately with ok=True.
    Otherwise: shows the server's warning text, opens the browser, polls until
    the session is live or the timeout expires.
    """
    ok, detail = await client.check_auth()
    if ok:
        return LoginOutcome(ok=True, detail="session already active")

    # Not authenticated -> run the interactive login (dedicated method, not the
    # data allowlist - only this helper can trigger a login flow).
    login_res = await client.login()
    raw = login_res.raw
    logger.info("login tool returned %d chars", len(raw))
    url = extract_login_url(raw)
    if not url:
        return LoginOutcome(ok=False, detail="could not locate authorize URL in login payload")

    # Surface the server's AI-safety warning to the user (required by the tool).
    # The raw payload embeds the authorize URL - print it WITHOUT the session_id
    # so a detached daemon's log never persists a login capability (MINOR-1).
    print(_strip_session_id(raw))
    if open_browser:
        webbrowser.open(url)
    # Console copy the user needs: keep the full URL on an interactive terminal,
    # strip it when stdout is a file (scheduled daemon -> data/logs/).
    printed_url = url if sys.stdout.isatty() else _strip_session_id(url)
    print(f"\nLogin link: {printed_url}\nComplete login in your browser (2FA). Waiting up to {int(timeout_seconds)}s...")

    waited = 0.0
    while waited < timeout_seconds:
        await asyncio.sleep(poll_interval)
        waited += poll_interval
        ok, detail = await client.check_auth()
        if ok:
            set_platform_value("zerodha", "last_login_at", _now_iso())
            return LoginOutcome(ok=True, detail="browser login completed", login_url=url)
    raise SessionLoginTimeout(
        f"browser login not completed within {int(timeout_seconds)}s"
    )


async def ensure_daily_session(
    open_browser: bool = True,
    timeout_seconds: float = 300.0,
    settings: Settings | None = None,
) -> ZerodhaMCPClient:
    """Connect and return an authenticated client, or raise on timeout."""
    client = ZerodhaMCPClient()
    await client.connect()
    try:
        outcome = await ensure_authenticated(
            client, open_browser=open_browser, timeout_seconds=timeout_seconds
        )
        if not outcome.ok:
            send_snapshot_expiry_warning("zerodha", outcome.detail, settings=settings)
            raise SessionLoginTimeout(outcome.detail)
        return client
    except SessionLoginTimeout as exc:
        send_snapshot_expiry_warning("zerodha", str(exc), settings=settings)
        raise
    except Exception:
        await client.close()
        raise


def _now_iso() -> str:
    from datetime import datetime

    return datetime.now(UTC).isoformat()