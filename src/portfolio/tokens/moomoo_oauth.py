"""Moomoo OAuth: one-time PKCE consent + automatic refresh.

Moomoo's hosted MCP is a standard MCP-OAuth server. Verified live (2026-08-06):
  https://mcp.moomoo.com/.well-known/oauth-authorization-server   -> RFC 8414 metadata
  https://mcp.moomoo.com/.well-known/oauth-protected-resource     -> RFC 9728 metadata
  /mcp returns 401 with WWW-Authenticate: Bearer resource_metadata=...

The `mcp` SDK's OAuthClientProvider implements the whole client side: metadata
discovery, dynamic client registration (RFC 7591), PKCE authorization-code
grant, token persistence, and automatic refresh on expiry/401. We supply the
three things only the app knows:

  - TokenStorage    -> data/tokens.json ("moomoo" slice), guardrail #2
  - redirect_handler-> open the consent URL in the browser
  - callback_handler-> loopback HTTP capture of ?code&state on 127.0.0.1:8788

Guardrail #1 (read-only scopes): the SDK's default scope selector requests
EVERY scope the server advertises (quote:read quote:write trade:read
trade:write accid:*). We pin the request to quote:read + trade:read by
wrapping the selector, and verify the granted scope afterwards. If a non
read-only scope is ever granted, the run fails loudly.
"""

from __future__ import annotations

import asyncio
import logging
import webbrowser
from collections.abc import Callable
from typing import Any

import httpx2
from mcp.client.auth import OAuthClientProvider
from mcp.client.auth.exceptions import OAuthFlowError
from mcp.client.auth.oauth2 import TokenStorage
from mcp.shared.auth import AuthorizationCodeResult, OAuthClientInformationFull, OAuthToken

from portfolio.config import Settings
from portfolio.tokens import store

logger = logging.getLogger("portfolio.tokens.moomoo")

MOOMOO_MCP_URL = "https://mcp.moomoo.com/mcp"
# Fixed loopback port so the redirect_uri registered with the server is stable
# across re-authorizations (it is part of both registration and consent).
CALLBACK_PORT = 8788
REDIRECT_URI = f"http://127.0.0.1:{CALLBACK_PORT}/callback"
CALLBACK_TIMEOUT_SECONDS = 300

# The ONLY scopes we ever request. trade:write is never requested (guardrail #1).
# accid:* is an account-identifier grant (which account ids the token may read),
# not an order-write grant - account tools 401 without it ("invalid_token").
READ_ONLY_SCOPES = ("quote:read", "trade:read", "accid:*")

CLIENT_NAME = "agentic-portfolio-dashboard"


# ---- scope enforcement (guardrail #1) ------------------------------------


_ORIGINAL_SCOPE_SELECTOR: Callable[..., str | None] | None = None


def _read_only_scope_selector(*args: Any, **kwargs: Any) -> str | None:
    """SDK scope selection, filtered down to our read-only set."""
    selected = _ORIGINAL_SCOPE_SELECTOR(*args, **kwargs)
    if not selected:
        return selected
    kept = [s for s in selected.split() if s in READ_ONLY_SCOPES or s == "offline_access"]
    return " ".join(kept) or None


def apply_read_only_scope_filter() -> None:
    """Idempotently patch the SDK's scope selector (guardrail #1).

    Without this, the provider requests every scope the server advertises -
    for Moomoo that includes trade:write. The patch is applied at provider
    build time so the write scope never leaves our process.
    """
    global _ORIGINAL_SCOPE_SELECTOR
    if _ORIGINAL_SCOPE_SELECTOR is not None:
        return
    import mcp.client.auth.oauth2 as oauth2

    _ORIGINAL_SCOPE_SELECTOR = oauth2.get_client_metadata_scopes
    oauth2.get_client_metadata_scopes = _read_only_scope_selector
    logger.info("read-only scope filter applied to MCP OAuth client")


def verify_granted_scope(scope: str | None) -> None:
    """Fail loudly if the authorization server granted anything beyond read-only."""
    if not scope:
        return
    granted = set(scope.split())
    non_read_only = granted - set(READ_ONLY_SCOPES) - {"offline_access"}
    if non_read_only:
        raise OAuthFlowError(f"non read-only scope granted: {sorted(non_read_only)}")


# ---- token storage on data/tokens.json (guardrail #2) ----------------------


class MoomooTokenStorage(TokenStorage):
    """TokenStorage protocol backed by the gitignored data/tokens.json store."""

    def __init__(self) -> None:
        self._platform = "moomoo"

    async def get_tokens(self) -> OAuthToken | None:
        raw = store.platform_store(self._platform).get("tokens")
        if not raw:
            return None
        return OAuthToken.model_validate(raw)

    async def set_tokens(self, tokens: OAuthToken) -> None:
        store.set_platform_value(self._platform, "tokens", tokens.model_dump(mode="json"))

    async def get_client_info(self) -> OAuthClientInformationFull | None:
        raw = store.platform_store(self._platform).get("client_info")
        if not raw:
            return None
        return OAuthClientInformationFull.model_validate(raw)

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        store.set_platform_value(self._platform, "client_info", client_info.model_dump(mode="json"))


# ---- interactive consent (manual, one-time) --------------------------------


async def _redirect_handler(authorization_url: str) -> None:
    """Open the consent screen. Nothing scripted past this point - the user
    grants (or denies) in the browser; that is the manual step, and unlike
    Zerodha/Groww it happens once, not daily (refresh tokens are long-lived)."""
    print("\n" + "=" * 72)
    print("Moomoo authorization required (one-time consent).")
    print("If the browser did not open, copy this URL:")
    print("\n" + authorization_url + "\n")
    print("On the consent page, CHECK/ALLOW every listed permission")
    print("(quote/market data AND trade/account data read access).")
    print("Then return here.")
    print("=" * 72 + "\n", flush=True)
    logger.info("open this URL in a browser to authorize: %s", authorization_url)
    webbrowser.open(authorization_url)


async def _callback_handler() -> AuthorizationCodeResult:
    """Wait for the browser redirect to http://127.0.0.1:8788/callback?code=..."""
    loop = asyncio.get_running_loop()
    future: asyncio.Future[AuthorizationCodeResult] = loop.create_future()

    async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request_line = (await asyncio.wait_for(reader.readline(), timeout=10)).decode("utf-8", "replace")
            # consume headers
            while True:
                line = await asyncio.wait_for(reader.readline(), timeout=10)
                if line in (b"\r\n", b"\n", b""):
                    break
            path = request_line.split(" ")[1] if len(request_line.split(" ")) > 1 else "/"
            if path.startswith("/callback"):
                from urllib.parse import parse_qs, urlparse

                query = parse_qs(urlparse(path).query)
                future.set_result(
                    AuthorizationCodeResult(
                        code=query.get("code", [None])[0],
                        state=query.get("state", [None])[0],
                        iss=query.get("iss", [None])[0],
                    )
                )
                body = b"<html><body><p>Authorized. You can close this tab and return to the terminal.</p></body></html>"
                writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
            else:
                writer.write(b"HTTP/1.1 204 No Content\r\n\r\n")  # e.g. favicon.ico
        except Exception as exc:  # noqa: BLE001 - surface as auth-flow failure
            if not future.done():
                future.set_exception(OAuthFlowError(f"callback capture failed: {exc}"))
        finally:
            await writer.drain()
            writer.close()

    server = await asyncio.start_server(_handle, "127.0.0.1", CALLBACK_PORT)
    try:
        return await asyncio.wait_for(future, timeout=CALLBACK_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        raise OAuthFlowError(
            f"no callback within {CALLBACK_TIMEOUT_SECONDS}s - consent not completed. "
            f"Re-run and complete the browser step."
        ) from exc
    finally:
        server.close()
        await server.wait_closed()


# ---- provider construction --------------------------------------------------


def build_auth_provider(
    storage: TokenStorage | None = None,
    scope: tuple[str, ...] = READ_ONLY_SCOPES,
    interactive: bool = True,
) -> OAuthClientProvider:
    """Build the SDK's OAuth client with read-only scopes and our handlers.

    The provider is used as the `auth` for an httpx2.AsyncClient passed into
    streamable_http_client(), so every MCP request carries the Bearer token and
    a 401 triggers the (re)authorization flow automatically.

    `interactive=False` (scheduled snapshot runs): no redirect/callback
    handlers, so if a 401 ever requires the consent browser the provider raises
    OAuthFlowError immediately instead of hanging an unattended run on a 5
    minute callback wait. Expiry then surfaces as a Telegram warning, and the
    user re-consents interactively.
    """
    apply_read_only_scope_filter()
    from mcp.shared.auth import OAuthClientMetadata

    metadata = OAuthClientMetadata(
        redirect_uris=[REDIRECT_URI],
        client_name=CLIENT_NAME,
        scope=" ".join(scope),
        grant_types=["authorization_code", "refresh_token"],
        token_endpoint_auth_method="none",
        response_types=["code"],
    )
    provider = OAuthClientProvider(
        server_url=MOOMOO_MCP_URL,
        client_metadata=metadata,
        storage=storage or MoomooTokenStorage(),
        redirect_handler=_redirect_handler if interactive else None,
        callback_handler=_callback_handler if interactive else None,
    )
    return provider


def build_authenticated_client(provider: OAuthClientProvider) -> httpx2.AsyncClient:
    """httpx2 client that auto-refreshes via the provider (used as http_client=...)."""
    return httpx2.AsyncClient(auth=provider, timeout=httpx2.Timeout(60.0))


def auth_status(provider: OAuthClientProvider) -> tuple[bool, str]:
    """Best-effort sync status from the provider's own storage (no network)."""
    import asyncio

    async def _status() -> tuple[bool, str]:
        tokens = await provider.context.storage.get_tokens()
        if tokens is None:
            return False, "no tokens stored - run a snapshot to start the one-time consent"
        return True, f"token stored, scope={tokens.scope or '(unspecified)'}"

    try:
        return asyncio.run(_status())
    except Exception as exc:  # noqa: BLE001 - status must never crash
        return False, f"{type(exc).__name__}: {exc}"


def settings() -> Settings:
    return Settings()
