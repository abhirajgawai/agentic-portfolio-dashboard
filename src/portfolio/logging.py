"""Logging setup with a mandatory secret-redaction filter (guardrail #2).

Any secret that passes through the logging pipeline is masked before a formatter
renders it. We redact at the record level (msg + args), so it works regardless of
the formatter in use.

Redacted by default:
  * `label=value` / `label: value` for common secret labels
    (access_token, refresh_token, api_key, apikey, secret, password, passwd,
    bearer, authorization, auth_token, login_token, request_token)
  * a JWT-ish Base64URL payload (three dot-separated segments)
  * long Base64-looking blobs
In production we additionally register the live values from data/tokens.json so an
accidental echo of an actual token is masked too.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

REDACTED = "[REDACTED]"

# label(s) followed by an = or : and a quoted/unquoted value.
_GENERIC_SECRET = re.compile(
    r"(\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|auth[_-]?token"
    r"|secret|password|passwd|bearer|authorization|login|session[_-]?id|request[_-]?token)"
    r"[\"']?\s*[:=]\s*[\"']?)([A-Za-z0-9._\-+/=]{6,})",
    re.IGNORECASE,
)

# JWT-style header.payload.signature (dot-separated).
_JWT = re.compile(r"[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}")

# Long bare Base64-looking blob (>= 24 chars).
_BLOB = re.compile(r"\b[A-Za-z0-9+/]{24,}={0,2}\b")


class SecretRedactionFilter(logging.Filter):
    """Masks secrets in log records. Returns True to always keep the record."""

    def __init__(self, secret_values: Iterable[str] = (), name: str = "secret-redaction"):
        super().__init__(name)
        self._literal = [s for s in secret_values if s]

    def _redact(self, text: str) -> str:
        if not isinstance(text, str):
            return text
        for secret in self._literal:
            if secret in text:
                text = text.replace(secret, REDACTED)
        text = _GENERIC_SECRET.sub(lambda m: m.group(1) + REDACTED, text)
        text = _JWT.sub(REDACTED, text)
        text = _BLOB.sub(REDACTED, text)
        return text

    def filter(self, record: logging.LogRecord) -> bool:
        # Redact the FULLY-COMBINED message (msg % args). Redacting msg and args
        # separately misses secrets that only materialize after %s substitution.
        if isinstance(record.msg, str):
            combined = record.getMessage()
            record.msg = self._redact(combined)
            record.args = ()
        return True


def _load_token_values(tokens_path: Path) -> list[str]:
    """Return leaf string values from data/tokens.json for redaction."""
    values: list[str] = []
    try:
        data = json.loads(tokens_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return values

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
        elif isinstance(node, str) and len(node) >= 6:
            values.append(node)

    walk(data)
    return values


def setup_logging(
    *,
    level: int = logging.INFO,
    tokens_path: Path | None = None,
    stream: Any | None = None,
) -> None:
    """Install the redaction filter on a freshly configured root logger."""
    root = logging.getLogger()
    root.setLevel(level)

    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(stream if stream is not None else sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
    root.addHandler(handler)
    root.propagate = False

    secrets: list[str] = []
    if tokens_path is not None:
        secrets = _load_token_values(tokens_path)
    else:
        default_path = Path("data/tokens.json")
        if default_path.exists():
            secrets = _load_token_values(default_path)

    redaction = SecretRedactionFilter(secrets)
    # Attach at handler level: logger-level filters only see records logged
    # directly on that logger, while handler filters see every record it emits.
    handler.addFilter(redaction)
    root.addFilter(redaction)