"""Persistent token/session store (data/tokens.json, gitignored).

Guardrail #2: tokens live ONLY here, never in the DB or snapshots, and never on
stdout. Nothing in this module logs token values.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from portfolio.config import DATA_DIR

logger = logging.getLogger("portfolio.tokens")

TOKENS_PATH = Path(DATA_DIR) / "tokens.json"


def tokens_path() -> Path:
    return TOKENS_PATH


def load_tokens(path: Path | None = None) -> dict[str, Any]:
    """Load the token store. Returns {} if absent/corrupt."""
    p = path or TOKENS_PATH
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        logger.warning("tokens.json unreadable (corrupt?) - returning empty store")
        return {}


def save_tokens(data: dict[str, Any], path: Path | None = None) -> None:
    """Atomically write the token store (write-tmp + replace). Mode 0600 on POSIX."""
    p = path or TOKENS_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(p)
    lock_down(p)
    logger.debug("token store written: %s", p)


def lock_down(path: Path) -> None:
    """Restrict the token file to the owner where the platform supports it."""
    try:
        import stat

        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass  # Windows: chmod is a no-op for owner-only; file ACL governs.


def platform_store(platform: str, path: Path | None = None) -> dict[str, Any]:
    """Return the token sub-store for a platform (creates on demand, never writes)."""
    return load_tokens(path).get(platform, {})


def set_platform_value(platform: str, key: str, value: Any, path: Path | None = None) -> None:
    """Persist one value under a platform's slice of the token store."""
    data = load_tokens(path)
    platform_data = data.setdefault(platform, {})
    platform_data[key] = value
    save_tokens(data, path)
    logger.info("token-store update: platform=%s key=%s", platform, key)