"""Wake-path unit tests: spawn-on-demand for the opencode agent server.

Mocks only - never spawns a real server (the eval does that for real).
Covers the four behaviours that matter: the already-online fast path (no
spawn), the detached spawn (args / cwd / inherited env / log destination /
shell variant), the ONE-spawn concurrency guard for racing wake calls, and
the failure mapping (AgentWakeError on missing exe / early exit). The bridge
endpoint mapping (200 / 502) and the /api/ask no-self-heal pin live here too.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
from pathlib import Path
from unittest import mock

import pytest
from fastapi.testclient import TestClient

import portfolio.agent.wake as wake
from portfolio.bridge import app
from portfolio.config import ROOT_DIR


@pytest.fixture(autouse=True)
def _reset_wake_state():
    """Wake keeps module-level spawn state (the lock, the in-flight task, the
    last spawned proc) - reset it so tests never observe a previous test's
    spawn."""
    wake._spawn_in_flight = None
    wake._spawned_proc = None
    yield
    wake._spawn_in_flight = None
    wake._spawned_proc = None


def _fake_proc(*, pid: int = 4242, poll_return=None) -> mock.Mock:
    proc = mock.Mock()
    proc.pid = pid
    proc.poll.return_value = poll_return
    proc.returncode = 1
    return proc


def test_already_online_does_not_spawn(monkeypatch):
    async def fake_health(self):
        return True

    monkeypatch.setattr(wake.OpenCodeClient, "health", fake_health)
    with mock.patch("subprocess.Popen") as popen:
        state = asyncio.run(wake.ensure_agent_online())
    assert state == "already-online"
    popen.assert_not_called()


def test_offline_spawns_detached_with_right_args(monkeypatch, tmp_path):
    async def fake_health(self):
        return False

    monkeypatch.setattr(wake.OpenCodeClient, "health", fake_health)
    monkeypatch.setattr(wake, "EARLY_EXIT_WINDOW_S", 0.0)
    monkeypatch.setattr(wake, "SERVE_LOG_PATH", tmp_path / "opencode_serve.log")
    exe = tmp_path / "opencode.exe"
    exe.write_text("")
    monkeypatch.setattr(wake, "resolve_opencode_exe", lambda: exe)
    monkeypatch.setenv("OPENCODE_SERVER_PASSWORD", "s3cretpw")

    with mock.patch("subprocess.Popen", return_value=_fake_proc()) as popen:
        state = asyncio.run(wake.ensure_agent_online())
    assert state == "started"
    popen.assert_called_once()

    args = popen.call_args.args[0]
    assert "serve" in args
    assert "--port" in args and "4096" in args
    assert "--hostname" in args and "127.0.0.1" in args
    kwargs = popen.call_args.kwargs
    assert kwargs["cwd"] == ROOT_DIR
    # The production serve must inherit the client's Basic-auth env unchanged
    # (a copy of the live environment - nothing stripped).
    assert kwargs["env"]["OPENCODE_SERVER_PASSWORD"] == "s3cretpw"
    assert set(os.environ.items()) <= set(kwargs["env"].items())
    # stdout/stderr go to the gitignored serve log, never the parent's stdout.
    assert kwargs["stdout"].name == str(tmp_path / "opencode_serve.log")
    assert kwargs["stderr"] == subprocess.STDOUT
    # An absolute exe needs no cmd shim.
    assert kwargs["shell"] is False


def test_offline_bare_opencode_uses_cmd_shim(monkeypatch, tmp_path):
    async def fake_health(self):
        return False

    monkeypatch.setattr(wake.OpenCodeClient, "health", fake_health)
    monkeypatch.setattr(wake, "EARLY_EXIT_WINDOW_S", 0.0)
    monkeypatch.setattr(wake, "SERVE_LOG_PATH", tmp_path / "opencode_serve.log")
    # The bare fallback (parent == Path(".")) means a cmd shim on PATH.
    monkeypatch.setattr(wake, "resolve_opencode_exe", lambda: Path("opencode"))

    with mock.patch("subprocess.Popen", return_value=_fake_proc()) as popen:
        state = asyncio.run(wake.ensure_agent_online())
    assert state == "started"
    popen.assert_called_once()
    assert popen.call_args.kwargs["shell"] is True
    assert popen.call_args.args[0] == ["opencode", "serve", "--port", "4096", "--hostname", "127.0.0.1"]


def test_concurrent_calls_share_one_spawn(monkeypatch, tmp_path):
    async def fake_health(self):
        return False

    monkeypatch.setattr(wake.OpenCodeClient, "health", fake_health)
    monkeypatch.setattr(wake, "EARLY_EXIT_WINDOW_S", 0.0)
    monkeypatch.setattr(wake, "SERVE_LOG_PATH", tmp_path / "opencode_serve.log")
    exe = tmp_path / "opencode.exe"
    exe.write_text("")
    monkeypatch.setattr(wake, "resolve_opencode_exe", lambda: exe)

    with mock.patch("subprocess.Popen", return_value=_fake_proc(pid=7)) as popen:
        async def _race():
            return await asyncio.gather(
                wake.ensure_agent_online(), wake.ensure_agent_online()
            )

        results = asyncio.run(_race())
    assert results == ["started", "started"]
    popen.assert_called_once()


def test_early_exit_raises_agent_wake_error(monkeypatch, tmp_path):
    async def fake_health(self):
        return False

    monkeypatch.setattr(wake.OpenCodeClient, "health", fake_health)
    monkeypatch.setattr(wake, "SERVE_LOG_PATH", tmp_path / "opencode_serve.log")
    exe = tmp_path / "opencode.exe"
    exe.write_text("")
    monkeypatch.setattr(wake, "resolve_opencode_exe", lambda: exe)
    # The spawned process is already dead (busy port / EADDRINUSE).
    proc = _fake_proc(poll_return=1)

    with mock.patch("subprocess.Popen", return_value=proc) as popen, pytest.raises(wake.AgentWakeError) as excinfo:
        asyncio.run(wake.ensure_agent_online())
    popen.assert_called_once()
    assert "exited immediately" in str(excinfo.value)


def test_missing_exe_raises_agent_wake_error(monkeypatch, tmp_path):
    async def fake_health(self):
        return False

    monkeypatch.setattr(wake.OpenCodeClient, "health", fake_health)
    missing = tmp_path / "no" / "opencode.exe"
    monkeypatch.setattr(wake, "resolve_opencode_exe", lambda: missing)

    with mock.patch("subprocess.Popen") as popen, pytest.raises(wake.AgentWakeError) as excinfo:
        asyncio.run(wake.ensure_agent_online())
    popen.assert_not_called()
    assert "not found" in str(excinfo.value)


# -- bridge endpoint -------------------------------------------------------


def test_bridge_wake_already_online(monkeypatch):
    async def fake_online(*, wait_s: float = 60.0) -> str:
        return "already-online"

    monkeypatch.setattr("portfolio.bridge.ensure_agent_online", fake_online)
    with TestClient(app) as client:
        resp = client.post("/api/agent/wake")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "state": "already-online"}


def test_bridge_wake_started(monkeypatch):
    async def fake_online(*, wait_s: float = 60.0) -> str:
        return "started"

    monkeypatch.setattr("portfolio.bridge.ensure_agent_online", fake_online)
    with TestClient(app) as client:
        resp = client.post("/api/agent/wake")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "state": "started"}


def test_bridge_wake_502_on_agent_wake_error(monkeypatch):
    async def fake_online(*, wait_s: float = 60.0) -> str:
        raise wake.AgentWakeError("opencode executable not found")

    monkeypatch.setattr("portfolio.bridge.ensure_agent_online", fake_online)
    with TestClient(app) as client:
        resp = client.post("/api/agent/wake")
    assert resp.status_code == 502
    body = resp.json()
    assert body["ok"] is False
    assert "not found" in body["error"]


def test_bridge_ask_still_503_when_agent_offline(monkeypatch):
    """Pin the no-self-heal contract: /api/ask keeps its exact 503 behaviour
    even though the wake endpoint now exists."""

    async def fake_health(self):
        return False

    monkeypatch.setattr("portfolio.agent.client.OpenCodeClient.health", fake_health)
    with TestClient(app) as client:
        resp = client.post("/api/ask", json={"question": "how many holdings?"})
    assert resp.status_code == 503
    assert resp.json() == {"error": "agent offline"}