"""Gmail OAuth: one-time consent for read-only access, used only to fetch
CAS emails from CAMS (Part B, docs/CAMS_KFINTECH_CAS_PLAN.md).

Google's OAuth2 (unlike Moomoo's MCP-OAuth in moomoo_oauth.py) needs a
manually created "Desktop app" OAuth client from Google Cloud Console - no
dynamic client registration like the MCP SDK provides. The user creates that
client once (client_id + client_secret); this module handles the browser
consent, token storage, and auto-refresh from there via google-auth-oauthlib.

Scope: gmail.readonly - the narrowest available. IMPORTANT (told to the user
before consent, see `portfolio auth --platform gmail`): Gmail has no
per-sender or per-label scope, so this grants read access to the user's
ENTIRE mailbox, not just CAS emails. The token lives only in the gitignored
data/tokens.json (guardrail #2), never logged, revocable anytime from the
user's Google Account permissions page.
"""

from __future__ import annotations

import logging

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

from portfolio.tokens import store

logger = logging.getLogger("portfolio.tokens.gmail")

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
PLATFORM = "gmail"


class GmailAuthError(Exception):
    """Gmail OAuth could not be completed, or stored credentials are unusable."""


def run_consent_flow(*, client_id: str, client_secret: str) -> None:
    """One-time interactive consent: opens a browser, runs a local loopback
    server to catch the redirect (InstalledAppFlow handles this entirely -
    no hand-rolled callback server needed, unlike moomoo_oauth.py's MCP
    flow). Stores client credentials + the resulting token in data/tokens.json.
    """
    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }
    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    creds = flow.run_local_server(port=0)
    store.set_platform_value(PLATFORM, "client_id", client_id)
    store.set_platform_value(PLATFORM, "client_secret", client_secret)
    _save_credentials(creds)


def _save_credentials(creds: Credentials) -> None:
    store.set_platform_value(
        PLATFORM,
        "credentials",
        {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes,
        },
    )


def load_credentials() -> Credentials:
    """Load stored credentials, refreshing the access token if expired.

    Raises GmailAuthError if Gmail was never configured, or the refresh
    fails - the caller must re-run `portfolio auth --platform gmail` rather
    than silently proceeding with an invalid token.
    """
    raw = store.platform_store(PLATFORM).get("credentials")
    if not raw:
        raise GmailAuthError("Gmail not configured - run `portfolio auth --platform gmail`")

    creds = Credentials(
        token=raw.get("token"),
        refresh_token=raw.get("refresh_token"),
        token_uri=raw.get("token_uri"),
        client_id=raw.get("client_id"),
        client_secret=raw.get("client_secret"),
        scopes=raw.get("scopes"),
    )
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as exc:  # noqa: BLE001 - any refresh failure must surface
                raise GmailAuthError(
                    f"Gmail token refresh failed: {type(exc).__name__} - "
                    "re-run `portfolio auth --platform gmail`"
                ) from exc
            _save_credentials(creds)
        else:
            raise GmailAuthError(
                "Gmail credentials invalid/expired - re-run `portfolio auth --platform gmail`"
            )
    return creds


def build_gmail_service() -> object:
    """Return an authenticated googleapiclient Gmail resource, ready to call
    (e.g. `.users().messages().list(...)`)."""
    from googleapiclient.discovery import build

    return build("gmail", "v1", credentials=load_credentials())
