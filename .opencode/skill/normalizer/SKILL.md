---
name: normalizer
description: Map raw MCP output per platform into the common holding schema, run FX one-rate-per-run, dedupe via UNIQUE(run_at, platform, ticker), and test with pinned fixtures. Use for M1-M3 normalization.
---

# Normalizer Skill

Normalizers translate platform-specific raw JSON into the common schema so the
consolidated view and dashboard are identical across platforms.

## Common schema (per holding)
```json
{
  "platform": "zerodha|groww|moomoo",
  "geography": "IN|US",
  "ticker": "RELIANCE",
  "name": "Reliance Industries",
  "quantity": 5,
  "avg_price": 2450.0,
  "current_price": 2580.0,
  "cost_basis": 12250.0,
  "current_value": 12900.0,
  "currency": "INR|USD",
  "sector": "Energy",
  "asset_class": "equity"
}
```
Snapshot row adds: `run_at` (UTC ISO), `snapshot_date`, `fx_rate_to_base`,
`current_value_base`, `is_eod` (bool).

## Files
- `src/portfolio/normalize/schema.py` — dataclasses + validation.
- `src/portfolio/normalize/zerodha.py`, `moomoo.py`, `groww.py` — one mapper each.
- Each mapper reads the pinned raw sample in `samples/<platform>/` and maps fields
  by their ACTUAL names (from `mcp-inspection`), never guessed.

## FX — one rate per run
- `src/portfolio/fx.py` fetches ONE `USD→INR` rate per run (e.g. from a reliable free
  source or platform quote). All USD holdings use that single rate.
- Store `fx_rate_to_base` per snapshot row for reproducibility. Never per-holding rates.

## Sector / asset class
- Prefer platform-provided data; else look up `data/sectors.csv` (ticker → sector,
  asset_class). Missing → `"Unknown"`.

## Dedupe / idempotency
- Rows `UNIQUE(run_at, platform, ticker)` — re-running the same `run_at` upserts in
  place (INSERT ... ON CONFLICT DO UPDATE). No duplicate rows ever.

## Tests
- Fixture test per platform: feed pinned `samples/` JSON, assert exact expected common
  schema output (incl. rounding). FX test asserts one rate applied across USD holdings.
- `uv run pytest tests/` and `uv run ruff check .` must pass.