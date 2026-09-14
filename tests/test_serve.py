"""M1 daemon idempotency guard: `portfolio serve` must never start a SECOND
daemon (second hosted-MCP connection, second daily login prompt, bind crash)
when one is already healthy on the port. The 09:35 IST scheduled serve task
overlaps a manually-started daemon in normal operation, so this is a real
scheduling boundary - guarded here with a fake /health endpoint (no network).
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import pytest

from portfolio import serve


def _fake_daemon(payload: dict) -> HTTPServer:
    """A tiny loopback server answering GET /health with `payload`."""

    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: object) -> None:  # silence test noise
            pass

    srv = HTTPServer(("127.0.0.1", 0), _Handler)
    Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def test_run_exits_quietly_when_daemon_already_healthy(monkeypatch: pytest.MonkeyPatch) -> None:
    """A healthy daemon on the port -> serve.run returns without touching the
    hosted MCP at all (no second connection, no second login, no bind)."""
    srv = _fake_daemon({"ok": True, "auth": True})
    try:
        calls: list[str] = []
        monkeypatch.setattr(serve, "_run", lambda *a, **k: calls.append("_run"))
        monkeypatch.setattr(serve, "ZerodhaMCPClient", lambda *a, **k: calls.append("client"))
        serve.run(port=srv.server_address[1])
        assert calls == [], "a healthy daemon must short-circuit before any MCP work"
    finally:
        srv.shutdown()


def test_run_proceeds_when_port_is_quiet(monkeypatch: pytest.MonkeyPatch) -> None:
    """Nothing listening (connection refused) -> the normal start path runs."""
    calls: list[str] = []

    async def _run(*args, **kwargs) -> None:  # patched coroutine, not a sync call
        calls.append("_run")

    monkeypatch.setattr(serve, "_run", _run)
    serve.run(port=18787)  # ephemeral-ish port with nothing on it
    assert calls == ["_run"]


def test_run_defaults_to_port_reserved_for_zerodha(monkeypatch: pytest.MonkeyPatch) -> None:
    """The daemon's default must not reclaim Headroom's fixed port 8787."""
    calls: list[tuple[str, int]] = []

    async def _run(host: str, port: int) -> None:
        calls.append((host, port))

    monkeypatch.setattr(serve, "_run", _run)
    serve.run()

    assert calls == [("127.0.0.1", 8788)]


def test_run_proceeds_when_daemon_unhealthy(monkeypatch: pytest.MonkeyPatch) -> None:
    """A process answering but reporting ok:false must NOT block a fresh daemon."""
    srv = _fake_daemon({"ok": False, "auth": False, "detail": "connection lost"})
    try:
        calls: list[str] = []

        async def _run(*args, **kwargs) -> None:
            calls.append("_run")

        monkeypatch.setattr(serve, "_run", _run)
        serve.run(port=srv.server_address[1])
        assert calls == ["_run"]
    finally:
        srv.shutdown()
