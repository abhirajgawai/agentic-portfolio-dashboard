"""CAMS+KFintech CAS request module tests: config validation, response
parsing, and the schedule gate.

Mirrors test_fx.py's style: the browser-driving submission is injectable via
`submit=`, so no real Playwright/network call is made in the test suite.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from portfolio.cams_cas_request import (
    CamsRequestError,
    is_cas_request_due,
    request_cams_kfintech_cas,
    schedule_status,
    set_schedule,
)
from portfolio.db import connect
from portfolio.db.migrate import migrate

VALID_KWARGS = {"pan": "ABCDE1234F", "email": "investor@example.com", "password": "S3cret!"}

SUCCESS_TEXT = (
    "Success\nCAS-CAMS + KFintech\nYour CAS-CAMS + KFintech will be sent to "
    "your registered email id investor@example.com. Your reference number is CP221888204."
)


def test_missing_config_raises_without_submitting():
    calls = []

    def submit(pan: str, email: str, password: str) -> str:
        calls.append((pan, email, password))
        return SUCCESS_TEXT

    with pytest.raises(CamsRequestError, match="pan"):
        request_cams_kfintech_cas(pan=None, email="a@b.com", password="x", submit=submit)
    assert calls == []


def test_missing_config_lists_every_absent_field():
    with pytest.raises(CamsRequestError) as exc_info:
        request_cams_kfintech_cas(pan=None, email=None, password=None)
    msg = str(exc_info.value)
    assert "pan" in msg
    assert "email" in msg
    assert "password" in msg


def test_success_extracts_reference_number():
    seen = {}

    def submit(pan: str, email: str, password: str) -> str:
        seen["pan"] = pan
        seen["email"] = email
        seen["password"] = password
        return SUCCESS_TEXT

    ref = request_cams_kfintech_cas(**VALID_KWARGS, submit=submit)
    assert ref == "CP221888204"
    assert seen == VALID_KWARGS


def test_no_success_marker_raises():
    def submit(pan: str, email: str, password: str) -> str:
        return "Please enter a valid PAN."

    with pytest.raises(CamsRequestError, match="did not confirm success"):
        request_cams_kfintech_cas(**VALID_KWARGS, submit=submit)


def test_success_without_reference_number_raises():
    def submit(pan: str, email: str, password: str) -> str:
        return "Success but the page layout changed and dropped the reference number."

    with pytest.raises(CamsRequestError, match="no reference number"):
        request_cams_kfintech_cas(**VALID_KWARGS, submit=submit)


# ---- is_cas_request_due -----------------------------------------------------


@pytest.fixture()
def conn(tmp_path):
    db_path = tmp_path / "test.db"
    migrate(db_path)
    c = connect(db_path)
    yield c
    c.close()


def test_due_when_never_run_before(conn):
    due, reason = is_cas_request_due(conn, at=datetime.now(UTC))
    assert due is True
    assert "no prior" in reason


def test_not_due_within_interval(conn):
    now = datetime.now(UTC)
    conn.execute(
        "INSERT INTO runs (platform, snapshot_date, started_at, status, rows, is_eod) "
        "VALUES ('cams', ?, ?, 'ok', 1, 1)",
        (now.date().isoformat(), now.isoformat()),
    )
    conn.commit()
    due, reason = is_cas_request_due(conn, at=now + timedelta(hours=1))
    assert due is False
    assert "elapsed <" in reason


def test_due_after_interval_elapses(conn):
    now = datetime.now(UTC)
    conn.execute(
        "INSERT INTO runs (platform, snapshot_date, started_at, status, rows, is_eod) "
        "VALUES ('cams', ?, ?, 'ok', 1, 1)",
        (now.date().isoformat(), now.isoformat()),
    )
    conn.commit()
    due, reason = is_cas_request_due(conn, at=now + timedelta(days=3))
    assert due is True
    assert "elapsed >=" in reason


def test_disabled_schedule_never_due(conn):
    now = datetime.now(UTC)
    conn.execute("UPDATE cas_schedule SET enabled = 0 WHERE id = 1")
    conn.commit()
    due, reason = is_cas_request_due(conn, at=now)
    assert due is False
    assert reason == "disabled"


def test_naive_datetime_rejected(conn):
    with pytest.raises(ValueError, match="timezone-aware"):
        is_cas_request_due(conn, at=datetime(2026, 1, 1))


# ---- schedule_status / set_schedule ----------------------------------------


def test_schedule_status_defaults(conn):
    status = schedule_status(conn, at=datetime.now(UTC))
    assert status == {
        "intervalDays": 2,
        "enabled": True,
        "lastRequestedAt": None,
        "nextDueAt": None,
        "due": True,
        "reason": "no prior successful request",
    }


def test_schedule_status_computes_next_due_at(conn):
    now = datetime.now(UTC)
    conn.execute(
        "INSERT INTO runs (platform, snapshot_date, started_at, status, rows, is_eod) "
        "VALUES ('cams', ?, ?, 'ok', 1, 1)",
        (now.date().isoformat(), now.isoformat()),
    )
    conn.commit()
    status = schedule_status(conn, at=now)
    assert status["lastRequestedAt"] == now.isoformat()
    assert status["nextDueAt"] == (now + timedelta(days=2)).isoformat()
    assert status["due"] is False


def test_set_schedule_updates_interval(conn):
    set_schedule(conn, interval_days=5)
    status = schedule_status(conn, at=datetime.now(UTC))
    assert status["intervalDays"] == 5
    assert status["enabled"] is True  # untouched


def test_set_schedule_updates_enabled_only(conn):
    set_schedule(conn, enabled=False)
    status = schedule_status(conn, at=datetime.now(UTC))
    assert status["intervalDays"] == 2  # untouched
    assert status["enabled"] is False


def test_set_schedule_rejects_non_positive_interval(conn):
    with pytest.raises(ValueError, match="must be > 0"):
        set_schedule(conn, interval_days=0)
