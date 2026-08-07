"""Moomoo read-only MCP server over the OpenD gateway (M2 fallback).

Why this exists (spike conclusion, 2026-08-06): the hosted MCP
(mcp.moomoo.com) is standard MCP-OAuth, but its token endpoint grants only
`quote:read` to dynamically-registered clients - three consents, three times -
so the account/holdings tools 401 with "invalid_token". PLAN.md's fallback:
the official `moomoo-api` SDK against the local **OpenD gateway**
(127.0.0.1:11111), wrapped in our own read-only FastMCP server.

OpenD is a desktop app that holds the Moomoo login (manual, like the Zerodha
daemon holds the Kite session). This server is the read-only window into it.

Guardrail #1: ONLY read tools are registered (get_accounts / get_positions /
get_funds). Order place/modify/cancel tools are never registered anywhere. The
trade password for OpenD's unlock step is read from data/tokens.json
(moomoo.trade_password) or MOOMOO_TRADE_PASSWORD at startup and NEVER crosses
the MCP tool surface as an argument.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from mcp.server.mcpserver.server import MCPServer
from moomoo import RET_OK, OpenSecTradeContext, SecurityFirm, TrdMarket

from portfolio.config import DATA_DIR

logger = logging.getLogger("moomoo_mcp")

server = MCPServer("moomoo-opend", version="0.1.0", log_level="WARNING")


def _load_secret(key: str) -> str | None:
    """Trading password / security firm from tokens.json, then env. Never logged."""
    tokens_path = Path(DATA_DIR) / "tokens.json"
    if tokens_path.exists():
        try:
            return json.loads(tokens_path.read_text(encoding="utf-8")).get("moomoo", {}).get(key)
        except (OSError, json.JSONDecodeError):
            pass
    return os.environ.get(f"MOOMOO_{key.upper()}")


def _port_open(host: str, port: int, timeout: float = 2.0) -> bool:
    """Fail fast when OpenD is down - the SDK's constructor retries for ages."""
    import socket

    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


class MoomooOpendService:
    """Lazy connection to the OpenD gateway + read-only SDK calls."""

    def __init__(self, host: str = "127.0.0.1", port: int = 11111) -> None:
        self.host = host
        self.port = port
        self._ctx: OpenSecTradeContext | None = None
        self._password = _load_secret("trade_password")
        firm = _load_secret("security_firm") or "FUTUSG"
        self._firm = getattr(SecurityFirm, firm, None)

    def connect(self) -> None:
        if self._ctx is not None:
            return
        if not _port_open(self.host, self.port, timeout=2):
            raise RuntimeError(
                f"cannot reach OpenD on {self.host}:{self.port} - start it and log in "
                f"(download: moomoo.com/download/opend)."
            )
        kwargs: dict[str, Any] = {"host": self.host, "port": self.port}
        if self._firm is not None:
            kwargs["security_firm"] = self._firm
        try:
            ctx = OpenSecTradeContext(**kwargs)
        except Exception as exc:  # noqa: BLE001 - OpenD down -> clear error
            raise RuntimeError(
                f"cannot connect to OpenD on {self.host}:{self.port} - start it and log in "
                f"(download: moomoo.com/download/opend). Detail: {exc}"
            ) from exc
        if self._password:
            ret, data = ctx.unlock_trade(password=self._password, is_unlock=True)
            if ret != RET_OK:
                ctx.close()
                raise RuntimeError(f"unlock_trade failed: {data}")
        self._ctx = ctx
        logger.info("connected to OpenD + unlocked trade")

    def close(self) -> None:
        if self._ctx is not None:
            self._ctx.close()
            self._ctx = None

    def get_accounts(self) -> dict:
        self.connect()
        ret, data = self._ctx.get_acc_list()
        if ret != RET_OK:
            raise RuntimeError(f"get_acc_list failed: {data}")
        records = data.to_dict("records")
        if isinstance(records, dict):
            records = [records]
        return {"accounts": records}

    def get_positions(self, trd_env: str = "REAL", acc_id: str | int = "0", refresh_cache: bool = True) -> list[dict]:
        self.connect()
        ret, data = self._ctx.position_list_query(
            code="",
            position_market=TrdMarket.NONE,
            pl_ratio_min=None,
            pl_ratio_max=None,
            trd_env=trd_env,
            acc_id=int(acc_id),
            refresh_cache=refresh_cache,  # never serve a stale SDK cache
        )
        if ret != RET_OK:
            raise RuntimeError(f"position_list_query failed: {data}")
        if data is None or getattr(data, "empty", False):
            return {"positions": []}
        records = data.to_dict("records")
        # A single-position account can come back as a bare dict (SDK quirk).
        # MCPServer emits ONE text item per list element, so a bare list would
        # arrive at the client as multiple fragments and only the first parses.
        # Wrap in a dict -> one JSON object -> one text item.
        if isinstance(records, dict):
            records = [records]
        return {"positions": records}

    def get_funds(self, trd_env: str = "REAL", acc_id: str | int = "0", currency: str = "USD") -> dict:
        self.connect()
        ret, data = self._ctx.accinfo_query(trd_env=trd_env, acc_id=int(acc_id), currency=currency)
        if ret != RET_OK:
            raise RuntimeError(f"accinfo_query failed: {data}")
        records = data.to_dict("records")
        return records[0] if records else {}

    def get_fills(self, trd_env: str = "REAL", acc_id: str | int = "0", trd_market: str = "US") -> dict:
        """Today's executed trades (deals) for the account. Read-only - the daily
        trade ledger that XIRR needs; the account's fills cannot be backfilled."""
        self.connect()
        ret, data = self._ctx.deal_list_query(
            code="", trd_env=trd_env, acc_id=int(acc_id), refresh_cache=True
        )
        if ret != RET_OK:
            raise RuntimeError(f"deal_list_query failed: {data}")
        if data is None or getattr(data, "empty", False):
            return {"fills": []}
        records = data.to_dict("records")
        if isinstance(records, dict):
            records = [records]
        return {"fills": records}


_service = MoomooOpendService()


@server.tool()
def get_accounts() -> dict:
    """List the trading accounts visible through OpenD (REAL and SIMULATE).

    Returns {"accounts": [...]} with acc_id, trd_env, market_auth, etc.
    Read-only.
    """
    return _service.get_accounts()


@server.tool()
def get_positions(trd_env: str = "REAL", acc_id: str | int = "0", refresh_cache: bool = True) -> dict:
    """Current holdings for an account: {"positions": [...]} where each entry
    has code, qty, cost_price, nominal_price, market_val, cost_val, pl_ratio,
    currency. Read-only. Always refreshes the OpenD cache (the SDK otherwise
    serves a stale position list).

    The dict wrapper keeps the MCP result ONE JSON object: MCPServer emits one
    text item per list element, which a bare list would fragment into N texts
    (the client only parses the first).

    acc_id comes from get_accounts(); trd_env is 'REAL' (needs the stored trade
    password) or 'SIMULATE' (paper trading, no unlock required).
    """
    return _service.get_positions(trd_env=trd_env, acc_id=acc_id, refresh_cache=refresh_cache)


@server.tool()
def get_funds(trd_env: str = "REAL", acc_id: str | int = "0", currency: str = "USD") -> dict:
    """Account funds: cash, market_val, total_assets, buying_power. Read-only."""
    return _service.get_funds(trd_env=trd_env, acc_id=acc_id, currency=currency)


@server.tool()
def get_fills(trd_env: str = "REAL", acc_id: str | int = "0", trd_market: str = "US") -> dict:
    """Today's executed trades for the account: {"fills": [...]} with deal_id,
    code, qty, price, trd_side, time, fee. Read-only - feeds the daily trade
    ledger (XIRR input)."""
    return _service.get_fills(trd_env=trd_env, acc_id=acc_id, trd_market=trd_market)


def main() -> None:
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
