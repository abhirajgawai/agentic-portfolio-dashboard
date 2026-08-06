"""Environment loading and platform registry."""

from __future__ import annotations

import os
from pathlib import Path

# Project root = parent of src/
ROOT_DIR = Path(__file__).resolve().parent.parent.parent

DATA_DIR = ROOT_DIR / "data"
SAMPLES_DIR = ROOT_DIR / "samples"
HOLIDAYS_DIR = DATA_DIR / "holidays"
DB_PATH = Path(os.getenv("PORTFOLIO_DB_PATH", str(DATA_DIR / "portfolio.db")))


class Settings:
    """Thin env accessor. No secrets are logged anywhere."""

    def __init__(self, env: dict[str, str] | None = None) -> None:
        self._env = env if env is not None else os.environ

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._env.get(key, default)

    @property
    def base_currency(self) -> str:
        return self.get("BASE_CURRENCY", "INR").upper()

    @property
    def fx_source(self) -> str:
        return self.get("FX_SOURCE", "open.er-api.com")

    @property
    def telegram_bot_token(self) -> str | None:
        return self.get("TELEGRAM_BOT_TOKEN")

    @property
    def telegram_chat_id(self) -> str | None:
        return self.get("TELEGRAM_CHAT_ID")


# Platform registry: platform -> (geography, default currency)
# Token/session handling lives in src/portfolio/tokens/.
PLATFORMS: dict[str, dict[str, str]] = {
    "zerodha": {"geography": "IN", "currency": "INR"},
    "groww": {"geography": "IN", "currency": "INR"},
    "moomoo": {"geography": "US", "currency": "USD"},
}


def platform_geography(platform: str) -> str:
    try:
        return PLATFORMS[platform]["geography"]
    except KeyError as exc:
        raise ValueError(f"unknown platform: {platform!r}") from exc
