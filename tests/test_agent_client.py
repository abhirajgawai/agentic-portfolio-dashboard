"""Agent client unit tests: audit redaction, SSE event filtering, budgets.

The fragile bits of src/portfolio/agent/client.py that don't need a live
server: secret-safe arg summarising (the audit log's evidence must never carry
credentials), the session-scope filtering of the global /event stream, the
answer-echo sweep (MAJOR-1b - the final answer is the last place a secret can
reach the user/audit), and the budget/answer flags the eval asserts against.
The end-to-end behaviour is covered by scripts/eval_agent.py against a real
`opencode serve`.
"""

from __future__ import annotations

import json

from portfolio.agent.client import (
    AgentResult,
    _event_belongs,
    _redact_args,
    _truncate,
)
from portfolio.logging import redact_text


def test_redact_args_masks_secrets():
    args = {
        "ticker": "RELIANCE",
        "quantity": 10,
        "api_key": "sk-live-abcdef123456",
        "trade_password": "hunter2",
        "session_id": "kitemcp-xyz",
        "note": "x" * 500,
    }
    out = _redact_args(args)
    assert out["ticker"] == "RELIANCE"
    assert out["quantity"] == 10
    assert out["api_key"] == "[REDACTED]"
    assert out["trade_password"] == "[REDACTED]"
    assert out["session_id"] == "[REDACTED]"
    # Long values are truncated, never echoed whole.
    assert len(out["note"]) < 500 and "(500 chars)" in out["note"] and out["note"].startswith("xxx")
    assert "hunter2" not in str(out)
    assert "sk-live" not in str(out)


def test_redact_args_masks_upper_case_keys():
    out = _redact_args({"API_KEY": "v", "AccessToken": "w", "ticker": "MU"})
    assert out["API_KEY"] == "[REDACTED]"
    assert out["AccessToken"] == "[REDACTED]"
    assert out["ticker"] == "MU"


def test_redact_args_non_dict():
    assert _redact_args(["a", "b"])["_value"] == "['a', 'b']"


def test_truncate():
    assert _truncate("short") == "short"
    long = "y" * 200
    truncated = _truncate(long)
    assert len(truncated) < 200 and truncated.endswith("(200 chars)")


def test_event_belongs_filters_by_session():
    sid = "ses_A"
    tool = {
        "type": "message.part.updated",
        "properties": {"part": {"type": "tool", "sessionID": sid, "tool": "portfolio_data_x"}},
    }
    other_tool = {
        "type": "message.part.updated",
        "properties": {"part": {"type": "tool", "sessionID": "ses_B", "tool": "portfolio_data_x"}},
    }
    updated = {"type": "message.updated", "properties": {"info": {"sessionID": sid, "role": "assistant"}}}
    idle = {"type": "session.idle", "properties": {"sessionID": sid}}
    assert _event_belongs(tool, sid)
    assert not _event_belongs(other_tool, sid)
    assert _event_belongs(updated, sid)
    assert _event_belongs(idle, sid)
    assert not _event_belongs({"type": "session.idle", "properties": {"sessionID": "ses_B"}}, sid)
    assert not _event_belongs({"type": "unrelated", "properties": {}}, sid)


def test_agent_result_flags():
    ok = AgentResult(question="q", answer="68 holdings")
    assert ok.answered and ok.within_budget and not ok.aborted
    budgeted = AgentResult(question="q", answer="partial", aborted=True)
    assert budgeted.answered and not budgeted.within_budget
    timed = AgentResult(question="q", answer="", timed_out=True)
    assert not timed.answered


def test_tool_call_audit_row_carries_redacted_args():
    from portfolio.agent.client import ToolCall

    call = ToolCall(tool="portfolio_data_latest_snapshot", args={"platform": "zerodha"}, status="completed")
    row = call.to_audit_row(session_id="ses_A", question="count?")
    assert row["tool"] == "portfolio_data_latest_snapshot"
    assert row["args"] == {"platform": "zerodha"}
    assert row["session_id"] == "ses_A" and row["question"] == "count?"


def test_answer_sweep_masks_formatted_secrets(tmp_path, monkeypatch):
    """MAJOR-1b: redact_text() masks the shapes the logging filter masks.

    The client sweeps the final assembled answer through this before returning
    it - a future model that somehow echoed token-file content could never hand
    the secret to the user through the answer field. The DATA_DIR is pointed at
    an EMPTY tmp dir so the literal-token replacement (which uses the REAL
    data/tokens.json) cannot pre-empt the regexes and make this non-hermetic.
    """
    monkeypatch.setattr("portfolio.logging.DATA_DIR", tmp_path)
    answer = (
        "My api_key=sk-live-abcdef123456 and refresh_token=zzz999yyy888 were found,\n"
        "the jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c\n"
        "and a long blob AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4+QA== appeared."
    )
    masked = redact_text(answer)
    assert "sk-live" not in masked
    assert "zzz999yyy888" not in masked
    assert "[REDACTED]" in masked
    assert "eyJhbGciOiJIUzI1NiJ9" not in masked  # JWT payload is gone
    assert "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4+QA==" not in masked


def test_answer_sweep_masks_literal_tokens(tmp_path, monkeypatch):
    """The literal-value path: redact_text() masks real stored token VALUES."""
    tokens = tmp_path / "tokens.json"
    tokens.write_text(json.dumps({"moomoo": {"trade_password": "s3cretliteral"}}), encoding="utf-8")
    monkeypatch.setattr("portfolio.logging.DATA_DIR", tmp_path)
    masked = redact_text("the password is s3cretliteral and nothing else")
    assert "s3cretliteral" not in masked


def test_audit_question_is_masked_and_truncated(tmp_path):
    """MINOR-2: the audit-file `question` field does its own redaction.

    The JSONL audit row is written DIRECTLY (no logging handler in the path),
    so the question is masked here - formatted secrets and long tails cannot
    reach the evidence file.
    """
    from portfolio.agent.client import OpenCodeClient, ToolCall

    client = OpenCodeClient(base_url="http://127.0.0.1:1", audit_path=tmp_path / "audit.jsonl")
    call = ToolCall(tool="portfolio_data_latest_snapshot", args={"platform": "zerodha"}, status="completed")
    question = "what is the api_key=sk-live-abcdef123456 doing here? " + ("y" * 500)
    client._log_tool_call(call, session_id="ses_A", question=question)

    rows = [json.loads(line) for line in (tmp_path / "audit.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1
    row = rows[0]
    assert "sk-live-abcdef123456" not in row["question"]
    assert len(row["question"]) <= 120
    assert row["tool"] == "portfolio_data_latest_snapshot"
    assert row["args"] == {"platform": "zerodha"}


# -- M7 bugfix: one tool invocation emits MULTIPLE message.part.updated events
# -- with the same part.id (pending -> running -> completed/error). The FIRST
# -- event counts the turn; later events must UPDATE the stored call's status
# -- in place, and the audit row must carry the FINAL status, written exactly
# -- once per tool call.

def _tool_part(part_id: str, tool: str, status: str, *, error: str | None = None) -> dict:
    state: dict = {"input": {"platform": "zerodha"}, "status": status}
    if error is not None:
        state["error"] = error
    return {"id": part_id, "type": "tool", "tool": tool, "state": state}


def test_tool_event_first_seen_counts_turn_once():
    from portfolio.agent.client import ToolCall, _apply_tool_event

    seen: dict[str, ToolCall] = {}
    turn_count, changed = _apply_tool_event(_tool_part("p1", "portfolio_data_x", "pending"), seen, 0)
    assert turn_count == 1
    assert changed is True
    assert len(seen) == 1
    call = seen["p1"]
    assert call.tool == "portfolio_data_x"
    assert call.status == "pending"
    assert call.turn_index == 1
    assert call.args == {"platform": "zerodha"}

    # Same part id, same status (duplicate event): no second turn, no change.
    turn_count, changed = _apply_tool_event(_tool_part("p1", "portfolio_data_x", "pending"), seen, turn_count)
    assert turn_count == 1
    assert changed is False
    assert len(seen) == 1

    # A DIFFERENT part id is a new tool call -> second turn.
    turn_count, changed = _apply_tool_event(_tool_part("p2", "kite_get_holdings", "pending"), seen, turn_count)
    assert turn_count == 2
    assert changed is True
    assert len(seen) == 2


def test_tool_event_status_updates_in_place_until_completed():
    from portfolio.agent.client import ToolCall, _apply_tool_event

    seen: dict[str, ToolCall] = {}
    turn_count = 0
    for status in ("pending", "running", "completed"):
        turn_count, changed = _apply_tool_event(_tool_part("p1", "kite_get_holdings", status), seen, turn_count)
        assert turn_count == 1  # one distinct tool call across all three events
    assert len(seen) == 1
    call = seen["p1"]
    assert call.status == "completed"  # FINAL status, not the first-seen "pending"
    assert call.error is None
    assert call.turn_index == 1  # original turn index preserved
    assert call.tool == "kite_get_holdings"


def test_tool_event_error_status_captures_error():
    from portfolio.agent.client import ToolCall, _apply_tool_event

    seen: dict[str, ToolCall] = {}
    turn_count = 0
    for status in ("pending", "running"):
        turn_count, _ = _apply_tool_event(_tool_part("p1", "portfolio_data_x", status), seen, turn_count)
    turn_count, changed = _apply_tool_event(
        _tool_part("p1", "portfolio_data_x", "error", error="rate limited"), seen, turn_count
    )
    assert turn_count == 1
    assert changed is True
    assert seen["p1"].status == "error"
    assert seen["p1"].error == "rate limited"


def test_audit_row_written_once_with_final_status(tmp_path):
    """The new flow (first-seen -> track; terminal -> audit; end -> flush)
    writes EXACTLY ONE audit row per tool call, carrying the FINAL status."""
    from portfolio.agent.client import OpenCodeClient, ToolCall, _apply_tool_event

    client = OpenCodeClient(base_url="http://127.0.0.1:1", audit_path=tmp_path / "audit.jsonl")
    seen: dict[str, ToolCall] = {}
    audited: set[str] = set()
    turn_count = 0
    question = "what is my total portfolio value? " + ("z" * 400)

    # Handler per-event path: apply the event, then audit terminal calls.
    for status in ("pending", "running", "completed"):
        turn_count, _ = _apply_tool_event(_tool_part("p1", "portfolio_data_portfolio_total", status), seen, turn_count)
        client._maybe_audit(seen, audited, session_id="ses_A", question=question)
    assert turn_count == 1

    # End-of-turn flush (the ask() `finally`): must NOT write a second row.
    client._maybe_audit(seen, audited, session_id="ses_A", question=question, force=True)

    rows = [json.loads(line) for line in (tmp_path / "audit.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1
    assert rows[0]["status"] == "completed"  # final status, never "pending"
    assert rows[0]["tool"] == "portfolio_data_portfolio_total"
    assert rows[0]["args"] == {"platform": "zerodha"}
    assert rows[0]["turn_index"] == 1
    assert len(rows[0]["question"]) <= 120  # MINOR-2 masking path still applied


def test_aborted_turn_pending_call_flushed_with_last_status(tmp_path):
    """A call that never reaches a terminal status (aborted turn) is audited
    at turn end with its last-seen status - not dropped, not duplicated."""
    from portfolio.agent.client import OpenCodeClient, ToolCall, _apply_tool_event

    client = OpenCodeClient(base_url="http://127.0.0.1:1", audit_path=tmp_path / "audit.jsonl")
    seen: dict[str, ToolCall] = {}
    audited: set[str] = set()
    turn_count = 0

    # The turn is aborted while the call is still running: mid-turn audits
    # must NOT write anything (status is not terminal yet).
    for status in ("pending", "running"):
        turn_count, _ = _apply_tool_event(_tool_part("p1", "portfolio_data_x", status), seen, turn_count)
        client._maybe_audit(seen, audited, session_id="ses_A", question="aborted question")
    assert not (tmp_path / "audit.jsonl").exists()

    # End-of-turn flush (abort/`finally` path) writes the row once.
    client._maybe_audit(seen, audited, session_id="ses_A", question="aborted question", force=True)
    rows = [json.loads(line) for line in (tmp_path / "audit.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1
    assert rows[0]["status"] == "running"  # last-known status before the abort
    assert rows[0]["turn_index"] == 1

    # A second flush is a no-op: the exactly-once guarantee holds.
    client._maybe_audit(seen, audited, session_id="ses_A", question="aborted question", force=True)
    rows = [json.loads(line) for line in (tmp_path / "audit.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1