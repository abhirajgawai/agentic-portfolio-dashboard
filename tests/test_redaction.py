"""Guardrail #2: every log line passes through the secret redaction filter."""

from __future__ import annotations

import io
import logging

from portfolio.logging import setup_logging


def _capture(fn, stream: io.StringIO) -> str:
    setup_logging(stream=stream, tokens_path=None)
    logger = logging.getLogger("portfolio.test")
    fn(logger)
    return stream.getvalue()


def test_generic_token_label_is_redacted() -> None:
    stream = io.StringIO()
    out = _capture(lambda lg: lg.info("kite access_token=%s expires 6AM", "abc123XYZ987"), stream)
    assert "abc123XYZ987" not in out
    assert "[REDACTED]" in out


def test_bearer_header_is_redacted() -> None:
    stream = io.StringIO()
    out = _capture(
        lambda lg: lg.info("Authorization: Bearer %s", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"),
        stream,
    )
    assert "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" not in out
    assert "[REDACTED]" in out


def test_args_dict_values_are_redacted() -> None:
    stream = io.StringIO()
    out = _capture(
        lambda lg: lg.info("resp: %s", {"api_key": "sk-live-abcdefghijkl", "rows": 3}),
        stream,
    )
    assert "sk-live-abcdefghijkl" not in out
    assert "[REDACTED]" in out
    assert "rows" in out  # non-secret fields survive


def test_literal_secret_from_tokens_file_is_redacted(tmp_path) -> None:
    token_file = tmp_path / "tokens.json"
    token_file.write_text('{"zerodha": {"access_token": "kite-REAL-SECRET-VALUE"}}', encoding="utf-8")

    stream = io.StringIO()
    setup_logging(stream=stream, tokens_path=token_file)
    logging.getLogger("portfolio.test").warning("got %s", "kite-REAL-SECRET-VALUE")
    assert "kite-REAL-SECRET-VALUE" not in stream.getvalue()
    assert "[REDACTED]" in stream.getvalue()


def test_plain_secret_value_is_masked_by_blob_rule() -> None:
    stream = io.StringIO()
    blob = "dGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgbG9va2luZyBibG9iIHZhbHVlISEh"
    out = _capture(lambda lg: lg.info("raw dump: %s", blob), stream)
    assert blob not in out
