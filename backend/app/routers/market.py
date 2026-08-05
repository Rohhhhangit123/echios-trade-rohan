"""
Router exposing the simulated live market data feed.

GET /market/tick?symbol=AAPL
    -> current tick for the symbol (mid/bid/ask/spread + OHLCV of the
       "current" 1-second-replayed candle)

GET /market/candles?symbol=AAPL&count=100
    -> last `count` candles up to and including the current tick, oldest
       first, for chart backfill

Unknown symbols silently fall back to IBM rather than erroring, per product
decision (keeps the demo from breaking on a typo/stale frontend list).
"""

from fastapi import APIRouter, Query

from app.services import market_data_service as mds

router = APIRouter(prefix="/market", tags=["market"])


@router.get("/tick")
def get_tick(symbol: str = Query(..., description="Instrument symbol, e.g. AAPL")):
    return mds.get_tick(symbol)


@router.get("/candles")
def get_candles(
    symbol: str = Query(..., description="Instrument symbol, e.g. AAPL"),
    count: int = Query(100, ge=1, le=2000, description="Number of candles to return"),
):
    return {
        "symbol": symbol.upper(),
        "candles": mds.get_candles(symbol, count=count),
    }


@router.get("/symbols")
def list_symbols():
    return {"symbols": mds.available_symbols()}