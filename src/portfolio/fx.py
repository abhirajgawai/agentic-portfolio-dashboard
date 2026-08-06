"""Foreign exchange: one rate per run, persisted to fx_rates.

M1 scope: INR/INR = 1.0 (Zerodha is INR). The real one-rate-per-run fetch from a
free deterministic source (open.er-api.com) lands in M2 for USD holdings.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("portfolio.fx")


def get_fx_rate(base: str, quote: str) -> float:
    """Return the rate to convert `quote`-denominated value into `base`.

    Semantics: value_base = value_quote * rate.
    """
    if base == quote:
        return 1.0
    raise NotImplementedError(
        f"FX for {quote}/{base} arrives in M2 (open.er-api.com one-rate-per-run)."
    )