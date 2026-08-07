---
name: token-session
description: Manage broker sessions for Zerodha — daily MANUAL browser login (2FA), token storage/refresh in data/tokens.json, expiry detection, and Telegram reminder on expiry. Never automate login.
---

# Token & Session Management

Regulatory rule: **Zerodha requires a daily human login with 2FA.** There is no
automated login. This skill standardizes how sessions are handled. (Groww needs no
login at all — its data comes from the emailed CAS statement + the keyless AMFI NAV
feed; see the `mcp-inspection` skill / PLAN §2c.)

## Where tokens live
- `data/tokens.json` (gitignored). Shape:
  ```json
  {
    "zerodha": { "access_token": "...", "user_id": "...", "expires_at": "2026-08-06T15:30:00Z" },
    "moomoo": { "trade_password": "...", "refresh_token": "...", "expires_at": "..." }
  }
  ```

## Daily manual login (Zerodha)
1. The snapshot runner spawns the session daemon (`portfolio serve --platform zerodha`);
   the daemon's `login` tool prints an mcp.kite.trade/authorize link.
2. User completes browser login + 2FA manually (the daily regulatory step).
3. The daemon holds the authenticated connection for the trading day and serves
   read-only RPC to snapshot runs; no token file exchange is needed for Zerodha.
4. `expires_at` is deliberately conservative (e.g. end-of-session day) since APIs
   may revoke tokens server-side at day close.

## Moomoo (OAuth / OpenD)
- The OpenD desktop app holds the Moomoo login; `portfolio auth --platform moomoo`
  stores the trade password (unlock_trade) once.

## Expiry handling in the pipeline
- Before a snapshot run, the daemon health check detects an expired session
  (`login_required`). The leg:
  - Logs clearly, writes a `runs` row (status `error`).
  - Sends a Telegram message: "Zerodha login needed — run `portfolio serve
    --platform zerodha` and complete the 2FA."
  - Continues with other platforms. Never silently fail.

## Guardrails
- Never store TOTP secrets, phone numbers, or passwords in the repo.
- Log redaction filter scrubs `access_token`/`refresh_token` values.
- No Selenium, no TOTP auto-login, no headless browser automation of the login flow.
- Refuse any request to automate the login flow (regulatory + security).
