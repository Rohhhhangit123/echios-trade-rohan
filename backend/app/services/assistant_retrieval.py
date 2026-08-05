from __future__ import annotations

import asyncio
import csv
import json
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.services.assistant_citations import CitationRecord
from app.services.assistant_user_repository import (
    AssistantUserRepository,
    SqlAlchemyAssistantUserRepository,
)
from app.services.market_vector_store import CsvMarketVectorStore, get_market_vector_store


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
def _price_rows(ticker: str) -> tuple[tuple[datetime, Decimal, int, int], ...]:
    path = PRICE_DATA_DIR / f"simulated_{ticker}_live.csv"
    if not path.exists():
        return ()
    rows: list[tuple[datetime, Decimal, int, int]] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for line_number, row in enumerate(csv.DictReader(handle), start=2):
            try:
                rows.append(
                    (
                        datetime.fromisoformat(row["timestamp"]),
                        Decimal(row["close"]),
                        int(row["volume"]),
                        line_number,
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

    latest_time, latest_close, latest_volume, latest_line = eligible[-1]

    def close_on_or_before(target: date) -> Decimal | None:
        for timestamp, close, _, _ in reversed(eligible):
            if timestamp.date() <= target:
                return close
        return None

    previous_date = latest_time.date()
    previous_close: Decimal | None = None
    for timestamp, close, _, _ in reversed(eligible[:-1]):
        if timestamp.date() < previous_date:
            previous_close = close
            break

    relative_path = (
        PRICE_DATA_DIR / f"simulated_{ticker}_live.csv"
    ).relative_to(DATA_ROOT).as_posix()
    citation_id = f"csv:{relative_path}#L{latest_line}-L{latest_line}"
    return {
        "instrument": instrument.upper(),
        "simulation_ticker": ticker,
        "as_of": latest_time.isoformat(sep=" "),
        "close": _decimal(latest_close),
        "volume": latest_volume,
        "change_1d_pct": _pct_change(latest_close, previous_close),
        "change_7d_pct": _pct_change(
            latest_close,
            close_on_or_before(latest_time.date() - timedelta(days=7)),
        ),
        "change_30d_pct": _pct_change(
            latest_close,
            close_on_or_before(latest_time.date() - timedelta(days=30)),
        ),
        "source": "simulated_price_csv",
        "source_file": relative_path,
        "row_start": latest_line,
        "row_end": latest_line,
        "citation_ids": [citation_id],
    }


@lru_cache(maxsize=1)
def _news_rows() -> tuple[dict[str, Any], ...]:
    items: list[dict[str, Any]] = []
    for path in sorted(NEWS_DATA_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        article_index = 0
        for articles in payload.values():
            for article in articles:
                article_index += 1
                try:
                    published = datetime.strptime(article["time_published"], "%Y%m%dT%H%M%S")
                except (KeyError, TypeError, ValueError):
                    continue
                items.append(
                    {
                        **article,
                        "_published": published,
                        "_source_file": path.name,
                        "_article_index": article_index,
                    }
                )
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
        citation_id = f"json:{article['_source_file']}#article-{article['_article_index']}"
        matches.append(
            {
                "title": article.get("title", "Untitled simulated article"),
                "published_at": article["_published"].isoformat(),
                "ticker": best.get("ticker"),
                "relevance_score": best.get("relevance_score"),
                "sentiment_score": best.get("ticker_sentiment_score"),
                "sentiment_label": best.get("ticker_sentiment_label"),
                "source_file": article["_source_file"],
                "article_index": article["_article_index"],
                "citation_ids": [citation_id],
            }
        )
        if len(matches) >= limit:
            break
    return matches


def _question_tickers(question: str) -> set[str]:
    tokens = set(re.findall(r"\b[A-Z]{1,8}\b", question.upper()))
    found = tokens & (SIMULATION_TICKERS | set(SIMULATION_TICKER_ALIASES))
    company_aliases = {
        "apple": "AAPL",
        "google": "GOOGL",
        "alphabet": "GOOGL",
        "microsoft": "MSFT",
        "tesla": "TSLA",
        "walmart": "WMT",
        "unilever": "UL",
    }
    lowered = question.lower()
    found.update(ticker for name, ticker in company_aliases.items() if name in lowered)
    return {"GOOGL" if ticker == "GOOG" else ticker for ticker in found}


def _collect_citation_ids(value: Any) -> set[str]:
    citations: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "citation_id" and isinstance(item, str):
                citations.add(item)
            elif key == "citation_ids" and isinstance(item, list):
                citations.update(str(entry) for entry in item)
            else:
                citations.update(_collect_citation_ids(item))
    elif isinstance(value, list):
        for item in value:
            citations.update(_collect_citation_ids(item))
    return citations


async def build_assistant_context(
    session: AsyncSession,
    *,
    client_id: int,
    question: str,
    as_of: date,
    user_repository: AssistantUserRepository | None = None,
    vector_store: CsvMarketVectorStore | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[CitationRecord]]:
    settings = get_settings()
    lowered = question.lower()
    include_history = any(word in lowered for word in ("history", "lifecycle", "stage", "progress"))
    repository = user_repository or SqlAlchemyAssistantUserRepository(
        session,
        source_label=settings.assistant_user_data_source_label,
    )
    user_data = await repository.load(client_id=client_id, include_history=include_history)

    positions = user_data.positions
    trades = user_data.trades
    instruments = {position["instrument"] for position in positions}
    instruments.update(trade["instrument"] for trade in trades)
    explicit_tickers = _question_tickers(question)
    market_instruments = explicit_tickers or instruments

    snapshots = {
        instrument: snapshot
        for instrument in sorted(market_instruments)
        if (snapshot := market_snapshot(instrument, as_of)) is not None
    }

    latest_db_prices: dict[str, tuple[Decimal, list[str]]] = {}
    for trade in trades:
        latest_db_prices.setdefault(
            trade["instrument"],
            (Decimal(trade["trade_price"]), trade["citation_ids"]),
        )

    position_rows: list[dict[str, Any]] = []
    for position in positions:
        instrument = position["instrument"]
        if instrument in snapshots:
            current_price = Decimal(snapshots[instrument]["close"])
            price_source = "simulation"
            price_citations = snapshots[instrument]["citation_ids"]
        else:
            fallback_price, fallback_citations = latest_db_prices.get(
                instrument,
                (Decimal(position["average_price"]), position["citation_ids"]),
            )
            current_price = fallback_price
            price_source = "latest_database_trade"
            price_citations = fallback_citations
        quantity = Decimal(position["quantity"])
        average_price = Decimal(position["average_price"])
        market_value = quantity * current_price
        cost_basis = quantity * average_price
        pnl = market_value - cost_basis
        position_rows.append(
            {
                **position,
                "current_price": _decimal(current_price),
                "price_source": price_source,
                "market_value": _decimal(market_value),
                "unrealized_pnl": _decimal(pnl),
                "unrealized_pnl_pct": _pct_change(current_price, average_price),
                "citation_ids": list(dict.fromkeys(position["citation_ids"] + price_citations)),
            }
        )

    trade_rows: list[dict[str, Any]] = []
    for trade in trades:
        instrument = trade["instrument"]
        if instrument in snapshots:
            current_price = Decimal(snapshots[instrument]["close"])
            comparison_citations = snapshots[instrument]["citation_ids"]
        else:
            current_price, comparison_citations = latest_db_prices.get(
                instrument,
                (Decimal(trade["trade_price"]), trade["citation_ids"]),
            )
        filled_quantity = Decimal(trade["filled_quantity"])
        effective_quantity = filled_quantity if filled_quantity > 0 else Decimal(trade["quantity"])
        direction = Decimal("1") if trade["side"] == "BUY" else Decimal("-1")
        estimated_pnl = (
            current_price - Decimal(trade["trade_price"])
        ) * effective_quantity * direction
        trade_rows.append(
            {
                **trade,
                "quantity": _decimal(effective_quantity),
                "comparison_price": _decimal(current_price),
                "estimated_pnl": _decimal(estimated_pnl),
                "citation_ids": list(
                    dict.fromkeys(trade["citation_ids"] + comparison_citations)
                ),
            }
        )
    ranked_trades = sorted(
        trade_rows,
        key=lambda item: Decimal(item["estimated_pnl"]),
        reverse=True,
    )
    profitable_trades = [item for item in ranked_trades if Decimal(item["estimated_pnl"]) > 0]
    losing_trades = [item for item in reversed(ranked_trades) if Decimal(item["estimated_pnl"]) < 0]

    ledger_groups: dict[str, dict[str, Any]] = {}
    for entry in user_data.ledger_entries:
        group = ledger_groups.setdefault(
            entry["entry_type"],
            {
                "entry_type": entry["entry_type"],
                "cash_delta": Decimal("0"),
                "security_delta": Decimal("0"),
                "entry_count": 0,
                "citation_ids": [],
            },
        )
        group["cash_delta"] += Decimal(entry["cash_delta"])
        group["security_delta"] += Decimal(entry["security_delta"])
        group["entry_count"] += 1
        group["citation_ids"].extend(entry["citation_ids"])
    ledger_summary = [
        {
            **group,
            "cash_delta": _decimal(group["cash_delta"]),
            "security_delta": _decimal(group["security_delta"]),
            "citation_ids": list(dict.fromkeys(group["citation_ids"])),
        }
        for group in ledger_groups.values()
    ]

    semantic_store = vector_store or get_market_vector_store()
    semantic_hits = await asyncio.to_thread(
        semantic_store.search,
        question,
        as_of=as_of,
        tickers={_simulation_ticker(ticker) for ticker in market_instruments},
        limit=settings.assistant_semantic_result_limit,
    )
    semantic_context = [hit.as_context() for hit in semantic_hits]

    include_news = any(keyword in lowered for keyword in NEWS_KEYWORDS)
    news_rows = relevant_news(market_instruments, as_of) if include_news else []

    open_exception_citations = [user_data.open_exception_citation_id]
    context = {
        "data_policy": (
            "Database records are application records. Market prices and news are simulated; "
            "never describe them as live or real-world current data. Every factual claim must use "
            "only the citation IDs attached to its supporting records."
        ),
        "retrieval": {
            "method": (
                "dense semantic embeddings with exact cosine similarity and "
                "finance-aware numeric reranking"
            ),
            "embedding_model": semantic_store.embedder.name,
            "corpus": "CSV files only",
            "simulation_as_of_date": as_of.isoformat(),
        },
        "client": user_data.client,
        "positions": position_rows,
        "market_snapshots": list(snapshots.values()),
        "semantic_market_context": semantic_context,
        "recent_trades": trade_rows[:15],
        "most_profitable_trade_estimates": profitable_trades[:5],
        "largest_trade_loss_estimates": losing_trades[:5],
        "open_exception_count": {
            "value": len(user_data.open_exception_ids),
            "citation_ids": open_exception_citations,
        },
        "recent_exceptions": user_data.recent_exceptions,
        "ledger_summary": ledger_summary,
        "trade_history": user_data.trade_history,
        "simulated_news": news_rows,
    }

    citations = dict(user_data.citations)
    for snapshot in snapshots.values():
        citation_id = snapshot["citation_ids"][0]
        citations[citation_id] = CitationRecord(
            id=citation_id,
            source_type="csv",
            label="Simulated market price CSV",
            detail=(
                f"{snapshot['instrument']} close at {snapshot['as_of']}; "
                f"{snapshot['source_file']} row {snapshot['row_start']}"
            ),
            source_file=snapshot["source_file"],
            row_start=snapshot["row_start"],
            row_end=snapshot["row_end"],
        )
    for hit in semantic_hits:
        citations[hit.document_id] = CitationRecord(
            id=hit.document_id,
            source_type="csv",
            label="Semantic CSV retrieval",
            detail=(
                f"{hit.metadata['ticker']} {hit.metadata['start_date']} to "
                f"{hit.metadata['end_date']}; cosine score {hit.score:.3f}"
            ),
            source_file=hit.metadata["source_file"],
            row_start=hit.metadata["row_start"],
            row_end=hit.metadata["row_end"],
        )
    for article in news_rows:
        citation_id = article["citation_ids"][0]
        citations[citation_id] = CitationRecord(
            id=citation_id,
            source_type="json",
            label="Simulated market news",
            detail=f"{article['title']}; published {article['published_at']}",
            source_file=article["source_file"],
        )

    used_ids = _collect_citation_ids(context)
    used_citations = [citations[citation_id] for citation_id in sorted(used_ids) if citation_id in citations]
    return user_data.client, context, used_citations
