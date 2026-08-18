"""Shared curated sector/asset-class loader.

One loader for `data/sectors.csv` so the broker normalizers (snapshot.py) and
the CAS import path (cas_import.py) read the SAME map - never duplicated.

Keying contract (the reason this file exists):
  equities  -> ticker column is the trading symbol (RELIANCE, BAJFINANCE)
  MFs/ETFs  -> ticker column is the ISIN: CAS demat-MF rows have no symbol -
               the holding ticker IS the ISIN (INF879O01027 = Parag Parikh
               Flexi Cap), and Kite reports the Zerodha ETF's ISIN as its
               trading symbol, so the ISIN key covers both paths.

Deterministic: reads a committed CSV; no network, no LLM. Missing file -> {}.
"""

from __future__ import annotations

import csv

from portfolio.config import ROOT_DIR

_SECTORS_CSV = ROOT_DIR / "data" / "sectors.csv"
_NAMES_CSV = ROOT_DIR / "data" / "names.csv"


def load_sectors() -> dict[str, tuple[str | None, str | None]]:
    """Load data/sectors.csv {ticker -> (sector, asset_class)} if present.

    Comment lines (leading '#') are skipped BEFORE DictReader so they can
    never become junk lookup entries (MINOR-4).
    """
    if not _SECTORS_CSV.exists():
        return {}
    lookup: dict[str, tuple[str | None, str | None]] = {}
    with _SECTORS_CSV.open(newline="", encoding="utf-8") as fh:
        data_lines = (ln for ln in fh if not ln.lstrip().startswith("#"))
        for row in csv.DictReader(data_lines):
            ticker = (row.get("ticker") or "").strip()
            if ticker:
                lookup[ticker] = (row.get("sector") or None, row.get("asset_class") or None)
    return lookup


def load_names() -> dict[str, str]:
    """Load data/names.csv {ticker -> display name} if present.

    Complements sectors.csv: brokers like Kite send tradingsymbol + ISIN but
    NO security name, so the curated map fills the display-name gap
    (data/names.csv, sourced from the user's own CAS statement). Same comment
    + missing-file conventions as load_sectors: deterministic, no network.
    """
    if not _NAMES_CSV.exists():
        return {}
    lookup: dict[str, str] = {}
    with _NAMES_CSV.open(newline="", encoding="utf-8") as fh:
        data_lines = (ln for ln in fh if not ln.lstrip().startswith("#"))
        for row in csv.DictReader(data_lines):
            ticker = (row.get("ticker") or "").strip()
            name = (row.get("name") or "").strip()
            if ticker and name:
                lookup[ticker] = name
    return lookup
