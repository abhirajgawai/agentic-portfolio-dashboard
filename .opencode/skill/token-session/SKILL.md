---
name: token-session
description: Manage broker sessions for Zerodha and Groww — daily MANUAL browser login (2FA), token storage/refresh in data/tokens.json, expiry detection, and Telegram reminder on expiry. Never automate login.
---

# Token & Session Management

Regulatory rule: **Zerodha and Groww require a daily human login with 2FA.** There is
no automated login. This skill standardizes how sessions are handled.

## Where tokens live
- `data/tokens.json` (gitignored). Shape:
  ```json
  {
    "zerodha": { "access_token": "...", "user_id": "...", "expires_at": "2026-08-06T15:30:00Z" },
    "groww": { "api_auth_token": "...", "expires_at": "..." },
    "moomoo": { "refresh_token": "...", "expires_at": "..." }
  }
  ```

## Daily manual login (Zerodha, Groww)
1. Start a local helper session (`uv run python -m portfolio.session serve`) that
   prints a login link / opens the browser flow.
2. User completes browser login + 2FA manually.
3. The helper exchanges the result for a token and writes it to `data/tokens.json`
   with `expires_at`.
4. `expires_at` is deliberately conservative (e.g. end-of-session day) since APIs
   may revoke tokens server-side at day close.

## Moomoo (OAuth auto-refresh)
- `opencode mcp auth moomoo` triggers the OAuth flow; the refresh token lets opencode
  auto-refresh. Store refresh token in `data/tokens.json` for the pipeline client.

## Expiry handling in the pipeline
- Before a snapshot run, check `expires_at`. If expired/missing:
  - Log clearly, set the platform's snapshot status to `skipped_expired`.
  - Send a Telegram message: "Zerodha login needed — run the daily login helper."
  - Continue with other platforms. Never silently fail.
- A `sessions status` command shows all platforms' session health.

## Guardrails
- Never store TOTP secrets, phone numbers, or passwords in the repo.
- Log redaction filter scrubs `access_token`/`api_auth_token`/`refresh_token` values.
- No Selenium, no TOTP auto-login, no headless browser automation of the login flow.
- Refuse any request to automate the login flow (regulatory + security).