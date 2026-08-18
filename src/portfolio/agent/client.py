"""Async client for the opencode server API - the M7 Q&A agent runtime.

WHAT THIS MODULE IS
-------------------
`opencode serve` is a headless HTTP server that exposes the agentic loop as an
API. This client drives that loop from Python: create a session, post a
question, stream the server's SSE event bus until the answer is complete, and
enforce a turn budget and a wall-clock budget client-side.

HOW THE STREAM WORKS
--------------------
The flow is:
    POST /session                    -> session id
    POST /session/:id/prompt_async   -> 204; the agentic turn starts
    GET  /event                      -> a long-lived SSE stream of bus events
Events are JSON objects {type, properties}. The ones that matter here:
    message.part.updated   properties.part is a Part; a ToolPart
                           (part.type == "tool") carries ONE tool invocation:
                           part.tool (the tool name), part.state.input (its
                           args), part.state.status (pending/running/completed/
                           error). This is the audit source. A TextPart carries
                           streamed answer text.
                           IMPORTANT: one tool invocation emits MULTIPLE
                           message.part.updated events, all with the SAME
                           part.id - one per status transition
                           (pending -> running -> completed/error). The client
                           turns the FIRST event into a ToolCall and counts it
                           as a turn; every LATER event for the same part.id
                           only mutates that call's status/error in place, so
                           `result.tool_calls` and the audit log always carry
                           the FINAL status, never the first-seen "pending".
    message.updated        properties.info is the finished Message - the
                           assistant's final message carries the answer, or
                           info.error when the turn failed/aborted.
    session.idle           nothing left to run - the turn is done.
The client filters events by its own session id (the /event endpoint is
global; other clients' sessions emit events on the same stream).

WHERE THE BUDGET IS ENFORCED
----------------------------
maxTurns counts TOOL CALLS (agentic steps), not messages: every distinct tool
part seen on the stream is one turn. Exceeding maxTurns - or exceeding the
wall-clock timeout - fires POST /session/:id/abort, which interrupts the model
mid-loop; the stream then ends with an aborted/error message and we return
whatever text was produced so far. The agent's `steps` config is a generous
server-side backstop; THIS client is the hard, authoritative budget (PLAN:
"enforce maxTurns/time budget client-side via the abort endpoint").

WHY TOOL-CALL LOGGING IS THE AUDIT TRAIL
----------------------------------------
Every tool call is appended to a JSONL audit log (default
data/logs/agent_audit.jsonl, gitignored): tool name, a redacted args summary,
status and turn index. Each call is written EXACTLY ONCE, with its FINAL
observed status: the row lands as soon as the part reaches a terminal status
(completed/error), and anything still pending when the turn ends (aborted
turns, stream cut mid-call) is flushed with its last-seen status - never the
first-seen "pending". The M7 eval replays this log and asserts every executed
tool matches the portfolio-analyst allowlist - that is the "zero
non-allowlisted tool executions" proof. NOTE on redaction scope: the audit
file is written DIRECTLY via json.dumps and never passes through a logging
handler, so the handler-level redaction filter (portfolio.logging) does NOT
cover it - THIS module does its own redaction of every field it writes there
(args via the secret-key summariser, the question via the logging module's
redact_text() + truncation). The logging filter only covers what goes to
stdout. The same redact_text() sweep is applied to the final ASSEMBLED ANSWER
before it is returned: allowlisted tools are the only data source, and the
answer is the only remaining echo path, so sweeping it closes the loop on
guardrail #2 (a future model swap cannot echo token-file contents even if a
bug ever let one through the tool layer).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from portfolio.config import ROOT_DIR
from portfolio.logging import redact_text

logger = logging.getLogger("portfolio.agent.client")

# Default audit location (data/logs/ is gitignored - guardrail #2).
DEFAULT_AUDIT_PATH = ROOT_DIR / "data" / "logs" / "agent_audit.jsonl"

# Default opencode serve endpoint (the CLI default port).
DEFAULT_BASE_URL = "http://127.0.0.1:4096"

# Seconds to wait for the server to even answer a request before giving up.
REQUEST_TIMEOUT_S = 30.0

# Secret-ish arg keys whose VALUES are masked in the audit summary. Catches
# snake_case, camelCase and PascalCase labels (api_key, accessToken,
# RefreshToken, ...) via the boundary alternatives; case-insensitive.
_SECRET_KEY_RE = re.compile(
    r"(?:^|_|[A-Z])(access|refresh|request|login|auth|session|secret|password"
    r"|passwd|bearer|credential|api[_]?key|apikey)(?:_|$|[A-Z])",
    re.IGNORECASE,
)

_MAX_ARG_VALUE_CHARS = 120


@dataclass
class ToolCall:
    """One executed tool call, as observed on the event stream (the audit unit)."""

    tool: str
    args: dict[str, Any]          # redacted + truncated args summary
    status: str                   # pending | running | completed | error
    error: str | None = None
    turn_index: int = 0

    def to_audit_row(self, *, session_id: str, question: str) -> dict[str, Any]:
        return {
            "ts": datetime.now(UTC).isoformat(),
            "session_id": session_id,
            "question": question,
            "tool": self.tool,
            "args": self.args,
            "status": self.status,
            "error": self.error,
            "turn_index": self.turn_index,
        }


@dataclass
class AgentResult:
    """The outcome of one `ask()` call - what the eval asserts against."""

    question: str
    answer: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    turns: int = 0
    aborted: bool = False          # budget breach (turns or wall clock)
    timed_out: bool = False
    error: str | None = None
    elapsed_s: float = 0.0

    @property
    def answered(self) -> bool:
        return bool(self.answer.strip())

    @property
    def within_budget(self) -> bool:
        return not (self.aborted or self.timed_out)


def _redact_args(args: Any) -> dict[str, Any]:
    """A brief, redacted summary of tool-call arguments for the audit log.

    Values whose key smells like a secret are masked outright; everything else
    is truncated (strings) or kept as-is for numbers/bools. Never echo a full
    value that could carry credentials - the audit file is the evidence log.
    """
    if not isinstance(args, dict):
        return {"_value": _truncate(str(args))}
    out: dict[str, Any] = {}
    for key, value in args.items():
        if _SECRET_KEY_RE.search(str(key)):
            out[str(key)] = "[REDACTED]"
        elif isinstance(value, (dict, list)):
            out[str(key)] = _truncate(json.dumps(value, default=str)[:400])
        elif isinstance(value, str):
            out[str(key)] = _truncate(value)
        else:
            out[str(key)] = value
    return out


def _truncate(value: str) -> str:
    if len(value) <= _MAX_ARG_VALUE_CHARS:
        return value
    return f"{value[:_MAX_ARG_VALUE_CHARS]}...({len(value)} chars)"


def _apply_tool_event(
    part: dict[str, Any],
    tool_parts_seen: dict[str, ToolCall],
    turn_count: int,
) -> tuple[int, bool]:
    """Apply one `message.part.updated` tool-part event to the tracking state.

    A tool invocation emits MULTIPLE events with the same part.id - one per
    status transition (pending -> running -> completed/error). The FIRST event
    for an id creates the ToolCall and counts the turn; every LATER event for
    the same id updates that SAME call's status/error in place, so the final
    state of a pending -> running -> completed sequence is status="completed"
    with the original turn_index, and no second tool call / no double turn
    count.

    Returns (turn_count, changed): `turn_count` is the (possibly incremented)
    distinct-tool-call count; `changed` is True when the stored call's
    status/error actually changed (always True on first-seen, False for a
    no-op update like a duplicate event with the same status).
    """
    part_id = part.get("id")
    state = part.get("state") or {}
    if part_id not in tool_parts_seen:
        turn_count += 1
        tool_parts_seen[part_id] = ToolCall(
            tool=part.get("tool", "?"),
            args=_redact_args(state.get("input")),
            status=state.get("status", "pending"),
            error=str(state.get("error")) if state.get("status") == "error" else None,
            turn_index=turn_count,
        )
        return turn_count, True
    call = tool_parts_seen[part_id]
    new_status = state.get("status", call.status)
    new_error = str(state.get("error")) if new_status == "error" else None
    changed = new_status != call.status or new_error != call.error
    if changed:
        call.status = new_status
        call.error = new_error
    return turn_count, changed


class OpenCodeClient:
    """Async HTTP+SSE client for `opencode serve`."""

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        audit_path: Path | None = None,
        request_timeout: float = REQUEST_TIMEOUT_S,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.audit_path = Path(audit_path) if audit_path is not None else DEFAULT_AUDIT_PATH
        self._request_timeout = request_timeout
        # Optional basic auth: opencode serve is password-protected when
        # OPENCODE_SERVER_PASSWORD is set in the environment (the user's own
        # server). The eval spawns its own server WITHOUT that env var, so the
        # default path needs no auth and no secret ever crosses the wire here.
        password = os.environ.get("OPENCODE_SERVER_PASSWORD")
        self._headers = {}
        if password:
            import base64

            user = os.environ.get("OPENCODE_SERVER_USERNAME", "opencode")
            token = base64.b64encode(f"{user}:{password}".encode()).decode()
            self._headers["Authorization"] = f"Basic {token}"

    # -- low-level HTTP ---------------------------------------------------

    async def _request(self, method: str, path: str, *, body: Any = None) -> httpx.Response:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self._request_timeout) as client:
            response = await client.request(method, path, json=body, headers=self._headers)
            if response.status_code >= 400:
                raise RuntimeError(f"{method} {path} -> HTTP {response.status_code}: {response.text[:300]}")
            return response

    async def health(self) -> bool:
        """True when the server answers /global/health (server-not-running check)."""
        try:
            response = await self._request("GET", "/global/health")
            return bool(response.json().get("healthy"))
        except (httpx.ConnectError, httpx.ReadTimeout, OSError, RuntimeError):
            return False

    # -- public API -------------------------------------------------------

    async def ask(
        self,
        question: str,
        *,
        agent: str = "portfolio-analyst",
        max_turns: int = 12,
        timeout_s: float = 180.0,
        session_title: str | None = None,
    ) -> AgentResult:
        """Ask one question through the agent and wait for the final answer.

        The turn budget (`max_turns` tool calls) and the wall-clock budget
        (`timeout_s`) are enforced here, client-side: breaching either fires
        POST /session/:id/abort and the partial answer is returned with
        aborted/timed_out set.
        """
        started = time.monotonic()
        result = AgentResult(question=question)
        session_id: str | None = None
        # Tool tracking lives OUTSIDE the per-turn try so the end-of-turn
        # audit flush (in the outer `finally`) can always reach it - an
        # aborted turn or an exception mid-stream still audits every call
        # seen so far with its last-known status.
        tool_parts_seen: dict[str, ToolCall] = {}
        audited_parts: set[str] = set()
        try:
            session = await self._create_session(session_title or question[:80])
            session_id = session["id"]

            events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
            stream_task = asyncio.create_task(self._stream_events(session_id, events))

            try:
                await self._prompt(session_id, question, agent=agent)
                turn_count = 0

                while True:
                    remaining = timeout_s - (time.monotonic() - started)
                    if remaining <= 0:
                        result.timed_out = True
                        result.aborted = True
                        await self._abort(session_id)
                        break
                    try:
                        event = await asyncio.wait_for(events.get(), timeout=min(remaining, 5.0))
                    except TimeoutError:
                        # No event for 5s: still running (long model think).
                        continue

                    event_type = event.get("type", "")
                    props = event.get("properties") or {}

                    if event_type == "message.part.updated":
                        part = props.get("part") or {}
                        part_id = part.get("id")
                        if part.get("type") == "tool" and part_id:
                            is_new = part_id not in tool_parts_seen
                            turn_count, _changed = _apply_tool_event(
                                part, tool_parts_seen, turn_count
                            )
                            call = tool_parts_seen[part_id]
                            if is_new:
                                result.tool_calls.append(call)
                                logger.info(
                                    "tool %s (%s) turn=%d", call.tool, call.status, turn_count
                                )
                                if turn_count > max_turns:
                                    result.aborted = True
                                    logger.warning(
                                        "turn budget exceeded (%d > %d) - aborting",
                                        turn_count, max_turns,
                                    )
                                    await self._abort(session_id)
                                    break
                            # Audit exactly once per tool call, at its FINAL
                            # status: the row lands when the part reaches a
                            # terminal status (completed/error); calls still
                            # pending when the turn ends are flushed in the
                            # outer `finally` below.
                            self._maybe_audit(
                                tool_parts_seen, audited_parts,
                                session_id=session_id, question=question,
                            )
                    elif event_type == "message.updated":
                        info = props.get("info") or {}
                        if (
                            info.get("role") == "assistant"
                            and info.get("sessionID") == session_id
                            and info.get("time", {}).get("completed") is not None
                            and info.get("error")
                        ):
                            result.error = redact_text(str(info["error"])[:300])
                    elif event_type == "session.idle" and props.get("sessionID") == session_id:
                        break

                # Assemble the authoritative answer from the finished messages.
                result.answer = redact_text(await self._final_answer(session_id))
                result.turns = turn_count
            finally:
                stream_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await stream_task
        except Exception as exc:  # noqa: BLE001 - surface as a clean result.error
            logger.exception("ask() failed")
            result.error = redact_text(f"{type(exc).__name__}: {exc}")
        finally:
            if session_id is not None and tool_parts_seen:
                # Flush any calls that never reached a terminal status (aborted
                # turn, stream cut mid-call) - audited with last-seen status.
                self._maybe_audit(
                    tool_parts_seen, audited_parts,
                    session_id=session_id, question=question, force=True,
                )
            result.elapsed_s = round(time.monotonic() - started, 2)
        return result

    # -- internals --------------------------------------------------------

    async def _create_session(self, title: str) -> dict[str, Any]:
        response = await self._request("POST", "/session", body={"title": title})
        return response.json()

    async def _prompt(self, session_id: str, text: str, *, agent: str) -> None:
        """Start the turn asynchronously (204); the SSE stream drives progress."""
        body = {
            "agent": agent,
            "parts": [{"type": "text", "text": text}],
        }
        await self._request("POST", f"/session/{session_id}/prompt_async", body=body)

    async def _abort(self, session_id: str) -> None:
        try:
            await self._request("POST", f"/session/{session_id}/abort")
        except RuntimeError as exc:
            logger.warning("abort failed: %s", exc)

    async def _stream_events(
        self, session_id: str, queue: asyncio.Queue[dict[str, Any]]
    ) -> None:
        """Consume the global /event SSE stream, enqueueing OUR session's events.

        The stream is long-lived; this task runs for the duration of one ask()
        and is cancelled when the turn ends. Events for other sessions are
        dropped (each event carries a sessionID on its properties/part).
        """
        url = f"{self.base_url}/event"
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", url, headers=self._headers) as response:
                if response.status_code != 200:
                    raise RuntimeError(f"GET /event -> HTTP {response.status_code}")
                data_lines: list[str] = []
                async for line in response.aiter_lines():
                    if line.startswith("data:"):
                        data_lines.append(line[5:].strip())
                    elif line == "" and data_lines:
                        payload = "".join(data_lines)
                        data_lines = []
                        try:
                            event = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        if _event_belongs(event, session_id):
                            await queue.put(event)
            # Flush any trailing event on stream end.
            if data_lines:
                payload = "".join(data_lines)
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    return
                if _event_belongs(event, session_id):
                    await queue.put(event)

    async def _final_answer(self, session_id: str) -> str:
        """The last assistant message's text parts (authoritative final answer)."""
        response = await self._request("GET", f"/session/{session_id}/message")
        messages = response.json()
        assistant: list[tuple[int, list[dict[str, Any]]]] = []
        for item in messages:
            info = item.get("info") or {}
            if info.get("role") != "assistant":
                continue
            created = (info.get("time") or {}).get("created", 0)
            assistant.append((created, item.get("parts") or []))
        if not assistant:
            return ""
        _, parts = max(assistant, key=lambda pair: pair[0])
        texts = [
            p["text"] for p in parts
            if p.get("type") == "text" and not p.get("synthetic") and not p.get("ignored")
        ]
        return "\n".join(texts).strip()

    def _maybe_audit(
        self,
        tool_parts_seen: dict[str, ToolCall],
        audited_parts: set[str],
        *,
        session_id: str,
        question: str,
        force: bool = False,
    ) -> int:
        """Write audit rows for tool calls - EXACTLY ONE row per call.

        Called (a) after every tool-part event, to land the row the moment a
        call reaches a terminal status (completed/error - the FINAL status,
        not the first-seen "pending"), and (b) once at the end of the turn
        with force=True, to flush anything that never reached a terminal
        status (aborted turn, stream cut mid-call) with its last-seen status.
        `audited_parts` makes the exactly-once guarantee: terminal calls
        written mid-turn are skipped by the final flush. Returns the number
        of rows written.
        """
        written = 0
        for part_id, call in tool_parts_seen.items():
            if part_id in audited_parts:
                continue
            if force or call.status in ("completed", "error"):
                audited_parts.add(part_id)
                self._log_tool_call(call, session_id=session_id, question=question)
                written += 1
        return written

    def _log_tool_call(self, call: ToolCall, *, session_id: str, question: str) -> None:
        """Append one JSONL row to the audit log (the eval's evidence).

        The audit file is written directly and NEVER passes through a logging
        handler, so the handler filter does not cover it (MINOR-2): the
        `question` field is masked here - redact_text() for token-like content
        plus a hard truncate - exactly like the args summariser. A secret that
        rides along inside a question string cannot reach the file.
        """
        masked_question = redact_text(question)[: _MAX_ARG_VALUE_CHARS]
        row = call.to_audit_row(session_id=session_id, question=masked_question)
        try:
            self.audit_path.parent.mkdir(parents=True, exist_ok=True)
            with self.audit_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        except OSError as exc:  # audit must never break the answer
            logger.warning("audit log write failed: %s", exc)


def _event_belongs(event: dict[str, Any], session_id: str) -> bool:
    """Does this bus event concern our session? (The /event stream is global.)"""
    event_type = event.get("type", "")
    if event_type == "message.part.updated":
        return (event.get("properties") or {}).get("part", {}).get("sessionID") == session_id
    if event_type == "message.updated":
        return (event.get("properties") or {}).get("info", {}).get("sessionID") == session_id
    if event_type == "session.idle":
        return (event.get("properties") or {}).get("sessionID") == session_id
    return False
