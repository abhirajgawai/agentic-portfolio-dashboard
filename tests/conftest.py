"""Shared pytest config.

Auto-launching the Zerodha daemon from a snapshot is for REAL runs; tests
simulate the daemon via mocked _fetch/_collect, so they must never spawn or
probe the real daemon or open a browser.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _no_real_daemon(monkeypatch):
    monkeypatch.setenv("PORTFOLIO_NO_DAEMON", "1")
