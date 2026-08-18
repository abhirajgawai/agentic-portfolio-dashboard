---
name: returns-xirr
description: Compute per-ticker and portfolio returns, and portfolio XIRR with trade capture and a deterministic Newton/bisection solver. Use for M5 work.
---

# Returns & XIRR Skill

## Inputs needed
- **Holdings**: latest snapshot (avg_price, quantity, current_value).
- **Trades**: daily capture from each platform's read-only order/trade endpoint
  (`get_trades`, `get_orders`), stored in `trades` table:
  `(trade_date, platform, ticker, side BUY|SELL, quantity, price, fees, currency,
  fx_rate_to_base)`.

## Returns (simple, per holding & portfolio)
- `pnl = current_value - cost_basis`
- `return_pct = pnl / cost_basis`
- Portfolio: sum of cost_basis and current_value across holdings in base currency.
- Also compute 1-day / 7-day / 30-day portfolio change from snapshot history.

## XIRR (portfolio-level, money-weighted)
- Solve `sum(cf_i / (1 + r)^(t_i/365)) = 0` for `r` over all cash flows:
  - Negative flows: every BUY (cost), starting capital.
  - Positive flows: every SELL (proceeds).
  - Terminal flow: current portfolio value (positive) at `today`.
- Solver: deterministic **bisection on log-space** with a Newton polish
  (`src/portfolio/xirr.py`). Use the `pyxirr` library if adding a dependency is
  acceptable; otherwise a pure-Python implementation with a strict iteration cap.
- Return annualized rate; also expose the IRR array for the dashboard chart.

## Output
- `dashboard/public/data/xirr.json`: `{ asOf, perAccount: { "<platform>__<id>": {currency,
  xirrPct, terminalValue, flowCount} }, estimated }`.

## Determinism & correctness
- Trades captured daily; if trade capture misses a day, snapshot-to-snapshot deltas
  estimate flows and are flagged in the export as `estimated: true`.
- XIRR must be a pure function of inputs — no randomness, fixed precision.

## Tests
- Known IRR cases (e.g. single buy then sell at 10% → 10.00% within 1e-6).
- Empty/no-trade portfolio returns null without crashing.