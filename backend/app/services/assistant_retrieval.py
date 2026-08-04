from __future__ import annotations

import csv
import json
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ClientAccount,
    ExceptionStatus,
    LedgerEntry,
    Position,
    Trade,
    TradeException,
    TradeHistory,
)


DATA_ROOT = Path(__file__).resolve().parents[3] / "data"
PRICE_DATA_DIR = DATA_ROOT / "simulation_price_data_July_1-Aug_30"
NEWS_DATA_DIR = DATA_ROOT / "simulation_news_data_July_1-Aug_30"

# Supabase uses GOOGL while the supplied simulation files use GOOG.
SIMULATION_TICKER_ALIASES = {"GOOGL": "GOOG"}
SIMULATION_TICKERS = {"AAPL", "GOOG", "IBM", "MSFT", "TSLA", "UL", "WMT"}
NEWS_KEYWORDS = ("news", "headline", "sentiment", "outlook", "tip", "invest", "recommend")


def _decimal(value: Decimal | int | float | str) -> str:
    return format(Decimal(str(value)), "f")


def _pct_change(current: Decimal, previous: Decimal | None) -> str | None:
    if previous is None or previous == 0:
        return None
    value = (current - previous) / previous * Decimal("100")
    return _decimal(value.quantize(Decimal("0.01")))


def _simulation_ticker(instrument: str) -> str:
    ticker = instrument.upper()
    return SIMULATION_TICKER_ALIASES.get(ticker, ticker)


@lru_cache(maxsize=16)
def _price_rows(ticker: str) -> tuple[tuple[datetime, Decimal, int], ...]:
    path = PRICE_DATA_DIR / f"simulated_{ticker}_live.csv"
    if not path.exists():
        return ()
    rows: list[tuple[datetime, Decimal, int]] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            try:
                rows.append(
                    (
                        datetime.fromisoformat(row["timestamp"]),
                        Decimal(row["close"]),
                        int(row["volume"]),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
    return tuple(rows)


def market_snapshot(instrument: str, as_of: date) -> dict[str, Any] | None:
    ticker = _simulation_ticker(instrument)
    eligible = [row for row in _price_rows(ticker) if row[0].date() <= as_of]
    if not eligible:
        return None

    latest_time, latest_close, latest_volume = eligible[-1]

    def close_on_or_before(target: date) -> Decimal | None:
        for timestamp, close, _ in reversed(eligible):
            if timestamp.date() <= target:
                return close
        return None

    previous_date = latest_time.date()
    previous_close: Decimal | None = None
    for timestamp, close, _ in reversed(eligible[:-1]):
        if timestamp.date() < previous_date:
            previous_close = close
            break

    return {
        "instrument": instrument.upper(),
        "simulation_ticker": ticker,
        "as_of": latest_time.isoformat(sep=" "),
        "close": _decimal(latest_close),
        "volume": latest_volume,
        "change_1d_pct": _pct_change(latest_close, previous_close),
        "change_7d_pct": _pct_change(latest_close, close_on_or_before(latest_time.date() - timedelta(days=7))),
        "change_30d_pct": _pct_change(latest_close, close_on_or_before(latest_time.date() - timedelta(days=30))),
        "source": "simulated_price_csv",
    }


@lru_cache(maxsize=1)
def _news_rows() -> tuple[dict[str, Any], ...]:
    items: list[dict[str, Any]] = []
    for path in sorted(NEWS_DATA_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for articles in payload.values():
            for article in articles:
                try:
                    published = datetime.strptime(article["time_published"], "%Y%m%dT%H%M%S")
                except (KeyError, TypeError, ValueError):
                    continue
                items.append({**article, "_published": published, "_source_file": path.name})
    return tuple(sorted(items, key=lambda item: item["_published"], reverse=True))


def relevant_news(instruments: set[str], as_of: date, limit: int = 8) -> list[dict[str, Any]]:
    tickers = {_simulation_ticker(instrument) for instrument in instruments}
    matches: list[dict[str, Any]] = []
    for article in _news_rows():
        if article["_published"].date() > as_of:
            continue
        sentiments = [
            item
            for item in article.get("ticker_sentiment", [])
            if str(item.get("ticker", "")).upper() in tickers
        ]
        if not sentiments:
            continue
        best = max(sentiments, key=lambda item: float(item.get("relevance_score", 0) or 0))
        matches.append(
            {
                "title": article.get("title", "Untitled simulated article"),
                "published_at": article["_published"].isoformat(),
                "ticker": best.get("ticker"),
                "relevance_score": best.get("relevance_score"),
                "sentiment_score": best.get("ticker_sentiment_score"),
                "sentiment_label": best.get("ticker_sentiment_label"),
                "source": article["_source_file"],
            }
        )
        if len(matches) >= limit:
            break
    return matches


def _question_tickers(question: str) -> set[str]:
    tokens = set(re.findall(r"\b[A-Z]{1,8}\b", question.upper()))
    found = tokens & (SIMULATION_TICKERS | set(SIMULATION_TICKER_ALIASES))
    return {"GOOGL" if ticker == "GOOG" else ticker for ticker in found}


async def build_assistant_context(
    session: AsyncSession,
    *,
    client_id: int,
    question: str,
    as_of: date,
) -> tuple[ClientAccount, dict[str, Any], list[dict[str, str]]]:
    client = await session.get(ClientAccount, client_id)
    if client is None:
        raise LookupError(f"Client {client_id} not found")

    positions = (
        await session.execute(
            select(Position)
            .where(Position.client_id == client_id)
            .order_by(Position.instrument)
        )
    ).scalars().all()
    trades = (
        await session.execute(
            select(Trade)
            .where(Trade.client_id == client_id)
            .order_by(Trade.created_at.desc())
            .limit(50)
        )
    ).scalars().all()

    instruments = {position.instrument.upper() for position in positions}
    instruments.update(trade.instrument.upper() for trade in trades)
    explicit_tickers = _question_tickers(question)
    market_instruments = explicit_tickers or instruments

    snapshots = {
        instrument: snapshot
        for instrument in sorted(market_instruments)
        if (snapshot := market_snapshot(instrument, as_of)) is not None
    }

    latest_db_prices: dict[str, Decimal] = {}
    for trade in trades:
        latest_db_prices.setdefault(trade.instrument.upper(), trade.price)

    position_rows: list[dict[str, Any]] = []
    for position in positions:
        instrument = position.instrument.upper()
        current_price = (
            Decimal(snapshots[instrument]["close"])
            if instrument in snapshots
            else latest_db_prices.get(instrument, position.avg_price)
        )
        market_value = position.quantity * current_price
        cost_basis = position.quantity * position.avg_price
        pnl = market_value - cost_basis
        position_rows.append(
            {
                "instrument": instrument,
                "quantity": _decimal(position.quantity),
                "average_price": _decimal(position.avg_price),
                "current_price": _decimal(current_price),
                "price_source": "simulation" if instrument in snapshots else "latest_database_trade",
                "market_value": _decimal(market_value),
                "unrealized_pnl": _decimal(pnl),
                "unrealized_pnl_pct": _pct_change(current_price, position.avg_price),
            }
        )

    trade_rows: list[dict[str, Any]] = []
    for trade in trades:
        instrument = trade.instrument.upper()
        current_price = (
            Decimal(snapshots[instrument]["close"])
            if instrument in snapshots
            else latest_db_prices.get(instrument, trade.price)
        )
        effective_quantity = trade.filled_quantity if trade.filled_quantity > 0 else trade.quantity
        direction = Decimal("1") if trade.side.value == "BUY" else Decimal("-1")
        estimated_pnl = (current_price - trade.price) * effective_quantity * direction
        trade_rows.append(
            {
                "trade_id": trade.id,
                "instrument": instrument,
                "side": trade.side.value,
                "quantity": _decimal(effective_quantity),
                "trade_price": _decimal(trade.price),
                "comparison_price": _decimal(current_price),
                "estimated_pnl": _decimal(estimated_pnl),
                "status": trade.status.value,
                "simulated_trade": trade.simulated,
                "created_at": trade.created_at.isoformat(),
            }
        )
    ranked_trades = sorted(trade_rows, key=lambda item: Decimal(item["estimated_pnl"]), reverse=True)
    profitable_trades = [item for item in ranked_trades if Decimal(item["estimated_pnl"]) > 0]
    losing_trades = [item for item in reversed(ranked_trades) if Decimal(item["estimated_pnl"]) < 0]

    exception_count = await session.scalar(
        select(func.count(TradeException.id))
        .join(Trade, Trade.id == TradeException.trade_id)
        .where(Trade.client_id == client_id, TradeException.status == ExceptionStatus.OPEN)
    )
    recent_exceptions = (
        await session.execute(
            select(TradeException, Trade.instrument)
            .join(Trade, Trade.id == TradeException.trade_id)
            .where(Trade.client_id == client_id)
            .order_by(TradeException.created_at.desc())
            .limit(8)
        )
    ).all()

    ledger_rows = (
        await session.execute(
            select(
                LedgerEntry.entry_type,
                func.sum(LedgerEntry.cash_delta),
                func.sum(LedgerEntry.security_delta),
                func.count(LedgerEntry.id),
            )
            .where(LedgerEntry.client_id == client_id)
            .group_by(LedgerEntry.entry_type)
        )
    ).all()

    history_rows: list[dict[str, Any]] = []
    lowered = question.lower()
    if any(word in lowered for word in ("history", "lifecycle", "stage", "progress")):
        history = (
            await session.execute(
                select(TradeHistory)
                .join(Trade, Trade.id == TradeHistory.trade_id)
                .where(Trade.client_id == client_id)
                .order_by(TradeHistory.created_at.desc())
                .limit(30)
            )
        ).scalars().all()
        history_rows = [
            {
                "trade_id": row.trade_id,
                "from_status": row.from_status.value if row.from_status else None,
                "to_status": row.to_status.value,
                "note": row.note,
                "created_at": row.created_at.isoformat(),
            }
            for row in history
        ]

    include_news = any(keyword in lowered for keyword in NEWS_KEYWORDS)
    news_rows = relevant_news(market_instruments, as_of) if include_news else []

    context = {
        "data_policy": (
            "Database records are real application records. Market prices and news are simulated; "
            "never describe them as live or real-world current data."
        ),
        "simulation_as_of_date": as_of.isoformat(),
        "client": {
            "id": client.id,
            "name": client.name,
            "kyc_status": client.kyc_status.value,
            "nostro_balance": _decimal(client.nostro_balance),
        },
        "positions": position_rows,
        "market_snapshots": list(snapshots.values()),
        "recent_trades": trade_rows[:15],
        "most_profitable_trade_estimates": profitable_trades[:5],
        "largest_trade_loss_estimates": losing_trades[:5],
        "open_exception_count": int(exception_count or 0),
        "recent_exceptions": [
            {
                "exception_id": exc.id,
                "trade_id": exc.trade_id,
                "instrument": instrument,
                "stage": exc.stage.value,
                "reason": exc.reason,
                "status": exc.status.value,
                "created_at": exc.created_at.isoformat(),
            }
            for exc, instrument in recent_exceptions
        ],
        "ledger_summary": [
            {
                "entry_type": entry_type,
                "cash_delta": _decimal(cash_delta or 0),
                "security_delta": _decimal(security_delta or 0),
                "entry_count": count,
            }
            for entry_type, cash_delta, security_delta, count in ledger_rows
        ],
        "trade_history": history_rows,
        "simulated_news": news_rows,
    }

    sources = [
        {
            "label": "Supabase portfolio and trade records",
            "detail": f"Client {client.id}; retrieved for this question",
        }
    ]
    if snapshots:
        latest_snapshot = max(item["as_of"] for item in snapshots.values())
        sources.append(
            {
                "label": "Simulated market prices",
                "detail": f"CSV data through {latest_snapshot}",
            }
        )
    if news_rows:
        sources.append(
            {
                "label": "Simulated market news",
                "detail": f"JSON data through {news_rows[0]['published_at']}",
            }
        )
    return client, context, sources
