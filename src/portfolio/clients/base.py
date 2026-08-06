"""Shared helpers for MCP tool results (deterministic parsing, no LLM)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

LOGIN_REQUIRED_MARKERS = ("please log in first", "login first", "not authenticated", "unauthorized")


@dataclass
class ToolResult:
    """Normalized view of an MCP CallToolResult."""

    tool: str
    texts: list[str] = field(default_factory=list)
    is_error: bool = False
    error: str | None = None

    @property
    def raw(self) -> str:
        return "\n".join(self.texts)

    def json(self) -> Any:
        """Best-effort JSON parse of the text payload (the Kite MCP returns JSON text)."""
        for text in self.texts:
            try:
                return json.loads(text)
            except (json.JSONDecodeError, TypeError):
                continue
        return None

    def login_required(self) -> bool:
        low = self.raw.lower()
        return self.is_error and any(m in low for m in LOGIN_REQUIRED_MARKERS)


def to_tool_result(tool: str, result: Any) -> ToolResult:
    """Convert an mcp SDK CallToolResult into our plain dataclass."""
    is_error = bool(getattr(result, "is_error", False))
    error: str | None = None
    texts: list[str] = []
    for item in getattr(result, "content", []) or []:
        text = getattr(item, "text", None)
        if isinstance(text, str):
            texts.append(text)
    if is_error and not texts:
        error = getattr(result, "error", None) or "MCP tool error"
        if error:
            texts.append(str(error))
    return ToolResult(tool=tool, texts=texts, is_error=is_error, error=error)
