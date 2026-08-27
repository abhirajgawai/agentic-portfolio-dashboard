"""Poll Gmail for the CAMS+KFintech CAS mailback email and download its PDF
attachment (Part B, docs/CAMS_KFINTECH_CAS_PLAN.md).

Confirmed live 2026-08-24 via the Gmail MCP connector (an interactive-only
tool - see the module docstring caveat below) against the real CAS emails
already received this session:
  sender:  donotreply@camsonline.com
  subject: "Consolidated Account Statement - CAMS Mailback Request" (exact)
  attachment: filename ends in .pdf; mimeType is application/octet-stream,
              NOT application/pdf - filter by filename, never by MIME type.

The PDF is downloaded as-is (still password-protected) - no decryption here;
the existing `casparser` library (via cas_import.py) handles the password at
parse time, unchanged from the manual upload path.
"""

from __future__ import annotations

import base64
import logging
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("portfolio.cams_email_fetch")

CAMS_SENDER = "donotreply@camsonline.com"
CAMS_SUBJECT = "Consolidated Account Statement - CAMS Mailback Request"


class CamsEmailNotFoundError(Exception):
    """The expected CAS email did not arrive within the poll window."""


def _build_query(since: datetime) -> str:
    return f'from:{CAMS_SENDER} subject:"{CAMS_SUBJECT}" after:{since.strftime("%Y/%m/%d")}'


def _find_message_id(gmail_service: Any, *, since: datetime) -> str | None:
    """Return the newest matching message id whose actual arrival time is at
    or after `since`, or None if no such message exists yet.

    Gmail's `after:` query filter is day-granularity only - on a day with
    multiple CAS emails (e.g. repeated same-day requests during testing or
    normal re-runs), a day-level filter alone would happily return an OLDER
    email that already existed before this specific request, as a false
    match (regression found live 2026-08-24: `cas auto` requested a fresh
    CAS but imported a stale one from an earlier same-day request because
    the first poll immediately matched the old email). Each candidate's real
    `internalDate` (ms since epoch) is checked explicitly against `since` -
    Gmail returns results newest-first, so if the newest match is still too
    old, no older one in the list could qualify either.
    """
    since_ms = int(since.timestamp() * 1000)
    resp = (
        gmail_service.users()
        .messages()
        .list(userId="me", q=_build_query(since), maxResults=1)
        .execute()
    )
    messages = resp.get("messages") or []
    if not messages:
        return None
    candidate_id = messages[0]["id"]
    meta = (
        gmail_service.users()
        .messages()
        .get(userId="me", id=candidate_id, format="metadata")
        .execute()
    )
    if int(meta.get("internalDate", 0)) >= since_ms:
        return candidate_id
    return None


def _download_pdf_attachment(gmail_service: Any, message_id: str, *, dest_dir: Path) -> Path:
    message = gmail_service.users().messages().get(userId="me", id=message_id, format="full").execute()
    for part in message.get("payload", {}).get("parts") or []:
        filename = part.get("filename") or ""
        if not filename.lower().endswith(".pdf"):
            continue
        attachment_id = part.get("body", {}).get("attachmentId")
        if not attachment_id:
            continue
        attachment = (
            gmail_service.users()
            .messages()
            .attachments()
            .get(userId="me", messageId=message_id, id=attachment_id)
            .execute()
        )
        data = base64.urlsafe_b64decode(attachment["data"])
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / filename
        dest_path.write_bytes(data)
        return dest_path
    raise CamsEmailNotFoundError(f"message {message_id} matched but had no .pdf attachment")


def find_and_download_cas_pdf(
    *,
    gmail_service: Any,
    since: datetime,
    dest_dir: Path,
    timeout_seconds: int = 600,
    poll_interval_seconds: int = 30,
    sleep: Callable[[float], None] = time.sleep,
    now: Callable[[], float] = time.monotonic,
) -> Path:
    """Poll Gmail for the CAS email received at/after `since`, download its
    PDF attachment into `dest_dir`, return the path.

    Raises CamsEmailNotFoundError on timeout - the CAMS request may have
    succeeded but the email pipeline needs a human look; must never hang
    forever or silently report a false success.

    `gmail_service` is the built googleapiclient Gmail resource (injectable
    for tests, see tokens/gmail_oauth.py's build_gmail_service()). `sleep`
    and `now` are injectable so tests don't actually wait real time.
    """
    deadline = now() + timeout_seconds
    while True:
        message_id = _find_message_id(gmail_service, since=since)
        if message_id:
            return _download_pdf_attachment(gmail_service, message_id, dest_dir=dest_dir)
        if now() >= deadline:
            raise CamsEmailNotFoundError(
                f"no CAS email from {CAMS_SENDER} found within {timeout_seconds}s"
            )
        sleep(poll_interval_seconds)
