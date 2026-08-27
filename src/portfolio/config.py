"""Environment loading and platform registry."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Project root = parent of src/
ROOT_DIR = Path(__file__).resolve().parent.parent.parent

# Loaded once, at import time, from a fixed path (ROOT_DIR/.env) rather than
# python-dotenv's default cwd-search - a Task Scheduler wrapper or a shell
# started from some other directory must still find the real file.
# override=False (the default): a value already present in the process
# environment (OS-level persisted var, Task Scheduler, an explicit export)
# always wins over .env - .env is the fallback, not an override mechanism.
# Fixes a real fragility found 2026-08-24: env vars persisted via
# `[Environment]::SetEnvironmentVariable(...,'User')` only propagate to
# genuinely fresh top-level processes, NOT to children spawned from an
# already-running shell that predates the change (e.g. the bridge launched
# from an agent's long-lived tool session) - a committed-pattern .env file
# has no such inheritance timing issue, since every process reads it fresh
# from disk at its own startup.
load_dotenv(ROOT_DIR / ".env")

DATA_DIR = ROOT_DIR / "data"
SAMPLES_DIR = ROOT_DIR / "samples"
HOLIDAYS_DIR = DATA_DIR / "holidays"
# A relative PORTFOLIO_DB_PATH (e.g. the "data/portfolio.db" documented in
# .env.example) must resolve against ROOT_DIR, never the current process's
# cwd - a Task Scheduler wrapper never `cd`s into the repo before invoking
# python, so a bare Path(relative) resolved to whatever bogus cwd Task
# Scheduler defaults to (regression found live 2026-08-24: "Access is
# denied: 'data'" / "unable to open database file" once .env started being
# loaded and actually set this var for the first time). ROOT_DIR / x is a
# no-op when x is already absolute, so this is safe either way.
_db_path_env = os.getenv("PORTFOLIO_DB_PATH")
DB_PATH = (ROOT_DIR / _db_path_env) if _db_path_env else (DATA_DIR / "portfolio.db")


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


# Platform registry: platform -> (geography, settlement currency, display currency)
# Token/session handling lives in src/portfolio/tokens/.
#   currency         = the currency holdings are settled in (e.g. Moomoo holds USD
#                      assets in a Singapore account).
#   display_currency = the currency the account's leg is SHOWN in on the dashboard
#                      (zerodha -> INR, moomoo -> SGD). The global consolidation
#                      base stays Settings.base_currency (INR).
PLATFORMS: dict[str, dict[str, str]] = {
    "zerodha": {"geography": "IN", "currency": "INR", "display_currency": "INR"},
    "groww": {"geography": "IN", "currency": "INR", "display_currency": "INR"},
    "sharekhan": {"geography": "IN", "currency": "INR", "display_currency": "INR"},
    "moomoo": {"geography": "US", "currency": "USD", "display_currency": "SGD"},
    "real_estate": {"geography": "IN", "currency": "INR", "display_currency": "INR"},
}


def platform_geography(platform: str) -> str:
    try:
        return PLATFORMS[platform]["geography"]
    except KeyError as exc:
        raise ValueError(f"unknown platform: {platform!r}") from exc


def platform_display_currency(platform: str) -> str:
    try:
        return PLATFORMS[platform]["display_currency"]
    except KeyError as exc:
        raise ValueError(f"unknown platform: {platform!r}") from exc
