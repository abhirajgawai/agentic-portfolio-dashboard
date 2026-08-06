"""Telegram delivery for expiry warnings (M1) and rule alerts (M6).

Uses bot token + chat id from env (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, or
the token store). Never logs the bot token.
"""

from __future__ import annotations

import logging

import httpx

from portfolio.config import Settings

logger = logging.getLogger("portfolio.alerts.telegram")

API = "https://api.telegram.org/bot{token}/sendMessage"


def send_telegram(
    text: str,
    settings: Settings | None = None,
    token: str | None = None,
    chat_id: str | None = None,
) -> bool:
    """Send a plain-text message. Returns True on success.

    token/chat_id fall back to env; if still missing, log a warning and return
    False (configured-out Telegram must not crash the pipeline).
    """
    settings = settings or Settings()
    token = token or settings.telegram_bot_token
    chat_id = chat_id or settings.telegram_chat_id
    if not token or not chat_id:
        logger.warning("Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) - message dropped: %s", text[:80])
        return False

    try:
        resp = httpx.post(
            API.format(token=token),
            json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
            timeout=15,
        )
        resp.raise_for_status()
        logger.info("telegram message sent (%d chars)", len(text))
        return True
    except httpx.HTTPError as exc:
        logger.error("telegram send failed: %s", exc)
        return False


def send_snapshot_expiry_warning(platform: str, reason: str, settings: Settings | None = None) -> bool:
    """M1 requirement: expired session -> Telegram warning, not a silent failure."""
    msg = (
        f"\u26a0\ufe0f Portfolio pipeline: {platform} session expired/invalid.\n"
        f"Reason: {reason}\n"
        f"Action: run `portfolio serve --platform {platform}` and complete the browser login (2FA)."
    )
    return send_telegram(msg, settings=settings)
