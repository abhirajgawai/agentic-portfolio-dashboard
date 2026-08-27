"""cams_email_fetch tests: query building, attachment extraction, polling
timeout. Mirrors test_fx.py's style: gmail_service/sleep/now are injectable
fakes, so no real Gmail API call or real waiting happens in the test suite.
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime

import pytest

from portfolio.cams_email_fetch import (
    CAMS_SENDER,
    CAMS_SUBJECT,
    CamsEmailNotFoundError,
    _build_query,
    find_and_download_cas_pdf,
)


def test_build_query_contains_sender_subject_and_date():
    since = datetime(2026, 8, 24, tzinfo=UTC)
    query = _build_query(since)
    assert CAMS_SENDER in query
    assert CAMS_SUBJECT in query
    assert "after:2026/08/24" in query


class _FakeAttachments:
    def __init__(self, data: bytes):
        self._data = data

    def get(self, userId, messageId, id):  # noqa: A002 - matches google client's kwarg names
        return self

    def execute(self):
        return {"data": base64.urlsafe_b64encode(self._data).decode("ascii")}


class _FakeMessages:
    def __init__(self, *, list_pages: list[dict], message_by_id: dict[str, dict], attachment_data: bytes):
        self._list_pages = list_pages
        self._message_by_id = message_by_id
        self._attachment_data = attachment_data
        self.list_calls = 0

    def list(self, userId, q, maxResults):  # noqa: A002
        page = self._list_pages[min(self.list_calls, len(self._list_pages) - 1)]
        self.list_calls += 1
        return _Exec(page)

    def get(self, userId, id, format):  # noqa: A002
        return _Exec(self._message_by_id[id])

    def attachments(self):
        return _FakeAttachments(self._attachment_data)


class _Exec:
    def __init__(self, payload: dict):
        self._payload = payload

    def execute(self):
        return self._payload


class _FakeUsers:
    def __init__(self, messages: _FakeMessages):
        self._messages = messages

    def messages(self):
        return self._messages


class _FakeGmailService:
    def __init__(self, messages: _FakeMessages):
        self._users = _FakeUsers(messages)

    def users(self):
        return self._users


SINCE = datetime(2026, 8, 24, tzinfo=UTC)
SINCE_MS = int(SINCE.timestamp() * 1000)


def _message_with_pdf(filename: str, *, internal_date_ms: int = SINCE_MS + 1000) -> dict:
    return {
        "internalDate": str(internal_date_ms),
        "payload": {
            "parts": [
                {"filename": filename, "body": {"attachmentId": "att-1"}, "mimeType": "application/octet-stream"},
            ]
        },
    }


def test_finds_and_downloads_pdf_on_first_poll(tmp_path):
    pdf_bytes = b"%PDF-1.4 fake content"
    messages = _FakeMessages(
        list_pages=[{"messages": [{"id": "msg-1"}]}],
        message_by_id={"msg-1": _message_with_pdf("CJXXXXXX3F_test_CP1.pdf")},
        attachment_data=pdf_bytes,
    )
    service = _FakeGmailService(messages)

    path = find_and_download_cas_pdf(
        gmail_service=service,
        since=SINCE,
        dest_dir=tmp_path,
    )
    assert path.name == "CJXXXXXX3F_test_CP1.pdf"
    assert path.read_bytes() == pdf_bytes


def test_polls_until_email_arrives():
    sleeps: list[float] = []
    clock = {"t": 0.0}

    def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        clock["t"] += seconds

    def fake_now() -> float:
        return clock["t"]

    messages = _FakeMessages(
        list_pages=[{}, {}, {"messages": [{"id": "msg-1"}]}],  # empty, empty, found
        message_by_id={"msg-1": _message_with_pdf("found.pdf")},
        attachment_data=b"data",
    )
    service = _FakeGmailService(messages)

    import tempfile

    with tempfile.TemporaryDirectory() as d:
        from pathlib import Path

        path = find_and_download_cas_pdf(
            gmail_service=service,
            since=SINCE,
            dest_dir=Path(d),
            poll_interval_seconds=10,
            timeout_seconds=100,
            sleep=fake_sleep,
            now=fake_now,
        )
        assert path.name == "found.pdf"
    assert sleeps == [10, 10]  # two empty polls before the email appeared


def test_rejects_stale_email_and_keeps_polling_for_a_newer_one():
    """Regression for the 2026-08-24 bug: a same-day query match that
    actually predates this request (e.g. an older CAS email already in the
    inbox from an earlier same-day request) must NOT be accepted - the code
    must keep polling until a genuinely newer email arrives."""
    sleeps: list[float] = []
    clock = {"t": 0.0}

    def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        clock["t"] += seconds

    def fake_now() -> float:
        return clock["t"]

    stale_id = "msg-stale"
    fresh_id = "msg-fresh"
    messages = _FakeMessages(
        # Every poll's list() returns the same (stale) newest-match id at
        # first - list() alone can't distinguish stale from fresh, since
        # Gmail's `after:` filter is day-granularity only. Only the second
        # poll's underlying data actually has the fresh message.
        list_pages=[{"messages": [{"id": stale_id}]}, {"messages": [{"id": fresh_id}]}],
        message_by_id={
            stale_id: _message_with_pdf("stale.pdf", internal_date_ms=SINCE_MS - 5000),
            fresh_id: _message_with_pdf("fresh.pdf", internal_date_ms=SINCE_MS + 5000),
        },
        attachment_data=b"data",
    )
    service = _FakeGmailService(messages)

    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as d:
        path = find_and_download_cas_pdf(
            gmail_service=service,
            since=SINCE,
            dest_dir=Path(d),
            poll_interval_seconds=10,
            timeout_seconds=100,
            sleep=fake_sleep,
            now=fake_now,
        )
        assert path.name == "fresh.pdf"  # never accepted the stale one
    assert sleeps == [10]  # one poll rejected as stale, then found the fresh one


def test_raises_on_timeout_without_hanging(tmp_path):
    clock = {"t": 0.0}

    def fake_sleep(seconds: float) -> None:
        clock["t"] += seconds

    def fake_now() -> float:
        return clock["t"]

    messages = _FakeMessages(
        list_pages=[{}],  # never finds anything
        message_by_id={},
        attachment_data=b"",
    )
    service = _FakeGmailService(messages)

    with pytest.raises(CamsEmailNotFoundError, match="no CAS email"):
        find_and_download_cas_pdf(
            gmail_service=service,
            since=SINCE,
            dest_dir=tmp_path,
            timeout_seconds=25,
            poll_interval_seconds=10,
            sleep=fake_sleep,
            now=fake_now,
        )


def test_message_without_pdf_attachment_raises(tmp_path):
    messages = _FakeMessages(
        list_pages=[{"messages": [{"id": "msg-1"}]}],
        message_by_id={
            "msg-1": {
                "internalDate": str(SINCE_MS + 1000),
                "payload": {"parts": [{"filename": "notes.txt"}]},
            }
        },
        attachment_data=b"",
    )
    service = _FakeGmailService(messages)

    with pytest.raises(CamsEmailNotFoundError, match="no \\.pdf attachment"):
        find_and_download_cas_pdf(
            gmail_service=service,
            since=SINCE,
            dest_dir=tmp_path,
        )
