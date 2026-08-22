"""Bridge goal endpoints (M8.9): create / partial-update / delete.

The bridge must never touch SQLite directly - it shells to `portfolio goal`
and re-runs export_json.py. These tests pin that seam by mocking
subprocess.run entirely (the same isolation style as the wake tests' Popen
mocks), so they never need a real DB, CLI, or export - and do NOT depend on
goals.json landing in the exporter. Covered: the 200 ok-shape with a parsed
readback, pre-shell 422 validation of targetAmount (incl. inf), partial
update passing ONLY the given fields, unknown-id -> clean 404-style errors,
export-failure -> 502, and that the export subprocess is invoked after every
successful mutation.
"""

from __future__ import annotations

from unittest import mock

import pytest
from fastapi.testclient import TestClient

from portfolio.bridge import app

# Two lines so readback proves max-id selection (newest = #7, not #2).
GOAL_LIST_STDOUT = (
    "#2  Car  target=800,000.00  color=#22c55e\n"
    "#7  Emergency fund  target=50,000.00  color=#6f7cff\n"
)


def _proc(returncode: int = 0, stdout: str = "", stderr: str = "") -> mock.Mock:
    p = mock.Mock()
    p.returncode = returncode
    p.stdout = stdout
    p.stderr = stderr
    return p


def _fake_run(*, goal_rc: int = 0, goal_stdout: str = GOAL_LIST_STDOUT,
              goal_stderr: str = "", export_rc: int = 0):
    """subprocess.run double: export_json.py calls get export_rc; everything
    else is a goal CLI call. Records every cmd list for assertions."""
    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        if any("export_json.py" in str(part) for part in cmd):
            return _proc(export_rc, stdout="wrote dashboard exports\n")
        return _proc(goal_rc, stdout=goal_stdout, stderr=goal_stderr)

    fake_run.calls = calls
    return fake_run


# -- POST /api/goals --------------------------------------------------------


def test_goal_create_ok_shape_and_export_rerun():
    fake = _fake_run()
    with mock.patch("subprocess.run", new=fake), TestClient(app) as client:
        resp = client.post(
            "/api/goals",
            json={"label": "Emergency fund", "targetAmount": 50000, "color": "#6f7cff"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["goal"] == {
        "id": 7,
        "label": "Emergency fund",
        "targetAmount": 50000.0,
        "color": "#6f7cff",
        "crossedAt": None,
    }
    # add -> list (readback) -> export, in that order.
    assert len(fake.calls) == 3
    add_cmd, list_cmd, export_cmd = fake.calls
    assert add_cmd[1:5] == ["-m", "portfolio.cli", "goal", "add"]
    assert "--label" in add_cmd and "Emergency fund" in add_cmd
    assert "--target" in add_cmd and "50000.0" in add_cmd
    assert "--color" in add_cmd and "#6f7cff" in add_cmd
    assert list_cmd[3:5] == ["goal", "list"]
    assert any("export_json.py" in part for part in export_cmd)


def test_goal_create_without_color_omits_flag():
    fake = _fake_run()
    with mock.patch("subprocess.run", new=fake), TestClient(app) as client:
        resp = client.post("/api/goals", json={"label": "Car", "targetAmount": 800000})
    assert resp.status_code == 200
    assert "--color" not in fake.calls[0]


@pytest.mark.parametrize("bad_body", [
    b'{"label": "X", "targetAmount": 0}',
    b'{"label": "X", "targetAmount": -5}',
    # Infinity is not valid strict JSON for encoders, but a hostile/naive
    # client can still send it - the endpoint's isfinite guard must catch it.
    b'{"label": "X", "targetAmount": Infinity}',
])
def test_goal_create_invalid_target_rejected_before_shell(bad_body):
    fake = _fake_run()
    with mock.patch("subprocess.run", new=fake), TestClient(app) as client:
        resp = client.post(
            "/api/goals", content=bad_body, headers={"Content-Type": "application/json"}
        )
    assert resp.status_code == 422
    body = resp.json()
    assert body["ok"] is False
    assert "targetAmount" in body["error"]
    assert fake.calls == []  # never shelled out


def test_goal_create_cli_failure_maps_to_clean_error():
    fake = _fake_run(goal_rc=1, goal_stderr="goal add: FAILED - label must not be empty\n")
    with mock.patch("subprocess.run", new=fake), TestClient(app) as client:
        resp = client.post("/api/goals", json={"label": "", "targetAmount": 100})
    assert resp.status_code == 502
    body = resp.json()
    assert body["ok"] is False
    assert "FAILED" in body["error"]
    assert len(fake.calls) == 1  # export never ran


def test_goal_create_export_failure_maps_to_502():
    fake = _fake_run(export_rc=1, goal_stderr="boom\n")
    with mock.patch("subprocess.run", new=fake), TestClient(app) as client:
        resp = client.post("/api/goals", json={"label": "X", "targetAmount": 100})
    assert resp.status_code == 502
    assert resp.json()["ok"] is False
    assert "export failed" in resp.json()["error"]


# -- PATCH /api/goals/{goal_id} ---------------------------------------------


def test_goal_update_partial_passes_only_given_fields():
    # The readback line reflects the post-update row (what a real `goal list`
    # would print after the CLI applied the color change).
    fake = _fake_run(goal_stdout="#7  Car  target=800,000.00  color=#22c55e\n")
    with mock.patch("subprocess.run", new=fake), TestClient(app) as client:
        resp = client.patch("/api/goals/7", json={"color": "#22c55e"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["goal"]["id"] == 7
    assert body["goal"]["color"] == "#22c55e"

    update_cmd = fake.calls[0]
    assert update_cmd[3:6] == ["goal", "update", "7"]
    assert "--color" in update_cmd and "#22c55e" in update_cmd
    assert "--label" not in update_cmd
    assert "--target" not in update_cmd
    # readback + export still run after a successful mutation
    assert fake.calls[1][3:5] == ["goal", "list"]
    assert any("export_json.py" in part for part in fake.calls[2])


def test_goal_update_unknown_id_clean_404():
    fake = _fake_run(goal_rc=1, goal_stderr="goal update: FAILED - goal 99 not found\n")
    with mock.patch("subprocess.run", new=fake), TestClient(app) as client:
        resp = client.patch("/api/goals/99", json={"label": "New name"})
    assert resp.status_code == 404
    body = resp.json()
    assert body["ok"] is False
    assert "not found" in body["error"]
    assert len(fake.calls) == 1  # no readback, no export


def test_goal_update_empty_body_rejected():
    fake = _fake_run()
    with mock.patch("subprocess.run", new=fake), TestClient(app) as client:
        resp = client.patch("/api/goals/7", json={})
    assert resp.status_code == 422
    assert resp.json()["ok"] is False
    assert fake.calls == []


# -- DELETE /api/goals/{goal_id} --------------------------------------------


def test_goal_delete_missing_id_clean_error():
    fake = _fake_run(goal_rc=1, goal_stderr="goal delete: FAILED - goal 42 not found\n")
    with mock.patch("subprocess.run", new=fake), TestClient(app) as client:
        resp = client.delete("/api/goals/42")
    assert resp.status_code == 404
    body = resp.json()
    assert body["ok"] is False
    assert "not found" in body["error"]
    assert len(fake.calls) == 1  # export never ran


def test_goal_delete_ok_invokes_export():
    fake = _fake_run(goal_stdout="goal deleted: #42\n")
    with mock.patch("subprocess.run", new=fake), TestClient(app) as client:
        resp = client.delete("/api/goals/42")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["deleted"] == 42
    assert "wrote dashboard exports" in body["export"]
    assert fake.calls[0][3:6] == ["goal", "delete", "42"]
    assert any("export_json.py" in part for part in fake.calls[1])
