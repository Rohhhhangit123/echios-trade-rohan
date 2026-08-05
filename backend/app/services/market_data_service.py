"""
In-memory live-tick simulation service.

Loads all data/live/<TICKER>.parquet files once at import time, and derives
the "current" candle for any symbol as a pure function of wall-clock time:

    elapsed_seconds = now() - SIM_START_TIME
    index = elapsed_seconds % total_candles_for_symbol

This means there is no mutable simulation state anywhere — every request,
from every client, computes the same index independently. Restarting the
process just resets SIM_START_TIME to "now" and replay starts over from
the first candle, which is fine for demo purposes.

Spread formula (per-candle synthetic spread)
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pandas as pd

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "live"
FALLBACK_SYMBOL = "IBM"
PRICE_DECIMALS = 2

# Recorded once, at process start. This is intentional: SIM_START_TIME is
# always "now" when the app boots, so a short demo always replays from the
# first candle of the dataset regardless of what real-world date it is.
SIM_START_TIME = time.time()

# ---------------------------------------------------------------------------
# Load all symbols into memory at import time
# ---------------------------------------------------------------------------

_SYMBOL_DATA: dict[str, pd.DataFrame] = {}


def _load_all_symbols() -> None:
    if not DATA_DIR.exists():
        raise RuntimeError(f"Live data directory not found: {DATA_DIR}")

    parquet_files = sorted(DATA_DIR.glob("*.parquet"))
    if not parquet_files:
        raise RuntimeError(f"No parquet files found in {DATA_DIR}")

    for path in parquet_files:
        symbol = path.stem.upper()
        df = pd.read_parquet(path, engine="pyarrow")
        df = df.sort_values("timestamp").reset_index(drop=True)
        _SYMBOL_DATA[symbol] = df

    if FALLBACK_SYMBOL not in _SYMBOL_DATA:
        raise RuntimeError(
            f"Fallback symbol {FALLBACK_SYMBOL} not found among loaded symbols: "
            f"{sorted(_SYMBOL_DATA.keys())}"
        )


_load_all_symbols()


def available_symbols() -> list[str]:
    return sorted(_SYMBOL_DATA.keys())


def _resolve_symbol(symbol: str) -> str:
    """Uppercase + validate; unknown symbols silently fall back to IBM."""
    symbol = (symbol or "").upper().strip()
    if symbol in _SYMBOL_DATA:
        return symbol
    return FALLBACK_SYMBOL


def _current_index(symbol: str) -> int:
    df = _SYMBOL_DATA[symbol]
    elapsed_seconds = int(time.time() - SIM_START_TIME)
    return elapsed_seconds % len(df)


def _row_to_tick(symbol: str, row: pd.Series) -> dict:
    close = float(row["close"])
    high = float(row["high"])
    low = float(row["low"])
    candle_range = high - low

    # spread = max(close * 0.0002, candle_range * 0.02)

    volatility = candle_range / close

    spread = close * (
    0.00015 +      # minimum spread
    volatility * 0.25
    )

    mid = close
    bid = mid - spread / 2
    ask = mid + spread / 2

    return {
        "symbol": symbol,
        "timestamp": row["timestamp"].isoformat(),
        "open": round(float(row["open"]), PRICE_DECIMALS),
        "high": round(high, PRICE_DECIMALS),
        "low": round(low, PRICE_DECIMALS),
        "close": round(close, PRICE_DECIMALS),
        "volume": int(row["volume"]),
        "mid": round(mid, PRICE_DECIMALS),
        "bid": round(bid, PRICE_DECIMALS),
        "ask": round(ask, PRICE_DECIMALS),
        "spread": round(spread, PRICE_DECIMALS),
    }


def get_tick(symbol: str) -> dict:
    """Current live tick for a symbol. Falls back to IBM if symbol is unknown."""
    resolved = _resolve_symbol(symbol)
    df = _SYMBOL_DATA[resolved]
    index = _current_index(resolved)
    row = df.iloc[index]
    return _row_to_tick(resolved, row)


def get_candles(symbol: str, count: int = 100) -> list[dict]:
    """
    Last `count` candles up to and including the current index, oldest first.
    Handles wraparound (when current index - count < 0) by wrapping to the
    end of the dataset, consistent with the looping replay.
    """
    resolved = _resolve_symbol(symbol)
    df = _SYMBOL_DATA[resolved]
    total = len(df)
    count = max(1, min(count, total))

    current_index = _current_index(resolved)
    # Build the list of indices, oldest -> newest, wrapping around 0 if needed
    indices = [(current_index - offset) % total for offset in range(count - 1, -1, -1)]

    return [_row_to_tick(resolved, df.iloc[i]) for i in indices]