from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import tempfile
import threading
from array import array
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Protocol, Sequence

from app.config import get_settings


DATA_ROOT = Path(__file__).resolve().parents[3] / "data"
DEFAULT_CACHE_ROOT = Path(__file__).resolve().parents[2] / ".cache"
INDEX_SCHEMA_VERSION = "1"
HISTORICAL_CHUNK_ROWS = 7

COMPANY_NAMES = {
    "AAPL": "Apple",
    "GOOG": "Google Alphabet",
    "IBM": "IBM International Business Machines",
    "MSFT": "Microsoft",
    "TSLA": "Tesla",
    "UL": "Unilever",
    "WMT": "Walmart",
}


class EmbeddingBackend(Protocol):
    name: str

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class FastEmbedBackend:
    """Lazy, local ONNX embeddings. No text is sent to an embedding API."""

    def __init__(self, model_name: str, cache_dir: Path) -> None:
        self.name = model_name
        self._cache_dir = cache_dir
        self._model: Any | None = None

    def _get_model(self) -> Any:
        if self._model is None:
            from fastembed import TextEmbedding

            self._cache_dir.mkdir(parents=True, exist_ok=True)
            local_model_dir = self._cache_dir / f"manual-{self.name.rsplit('/', 1)[-1]}"
            local_model_ready = (
                (local_model_dir / "tokenizer.json").exists()
                and any(local_model_dir.glob("*.onnx"))
            )
            self._model = TextEmbedding(
                model_name=self.name,
                cache_dir=str(self._cache_dir),
                specific_model_path=str(local_model_dir) if local_model_ready else None,
            )
        return self._model

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]:
        model = self._get_model()
        return [vector.tolist() for vector in model.passage_embed(texts, batch_size=64)]

    def embed_query(self, text: str) -> list[float]:
        model = self._get_model()
        return next(iter(model.query_embed(text))).tolist()


@dataclass(frozen=True)
class MarketDocument:
    document_id: str
    text: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class MarketSearchHit:
    document_id: str
    text: str
    score: float
    metadata: dict[str, Any]

    def as_context(self) -> dict[str, Any]:
        return {
            "citation_id": self.document_id,
            "semantic_score": round(self.score, 4),
            "text": self.text,
            **self.metadata,
        }


def _normalize(vector: Iterable[float]) -> list[float]:
    values = [float(value) for value in vector]
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        raise ValueError("Embedding model returned a zero vector")
    return [value / norm for value in values]


def _pack_vector(vector: Sequence[float]) -> bytes:
    values = array("f", vector)
    if sys.byteorder != "little":
        values.byteswap()
    return values.tobytes()


def _unpack_vector(payload: bytes) -> array[float]:
    values = array("f")
    values.frombytes(payload)
    if sys.byteorder != "little":
        values.byteswap()
    return values


def _ticker_from_path(path: Path) -> str:
    match = re.search(r"(?:simulated_)?([A-Z]+)(?:_2026_historical|_live)$", path.stem)
    if not match:
        raise ValueError(f"Cannot derive ticker from CSV filename: {path.name}")
    return match.group(1)


def _read_numeric_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for line_number, row in enumerate(csv.DictReader(handle), start=2):
            try:
                timestamp = datetime.fromisoformat(row["timestamp"])
                rows.append(
                    {
                        "line": line_number,
                        "timestamp": timestamp,
                        "open": float(row["open"]),
                        "high": float(row["high"]),
                        "low": float(row["low"]),
                        "close": float(row["close"]),
                        "volume": int(float(row["volume"])),
                    }
                )
            except (KeyError, TypeError, ValueError):
                continue
    return rows


def _describe_chunk(
    *,
    ticker: str,
    relative_path: str,
    period_type: str,
    rows: Sequence[dict[str, Any]],
) -> MarketDocument:
    first, last = rows[0], rows[-1]
    opening = first["open"]
    closing = last["close"]
    period_return = ((closing - opening) / opening * 100) if opening else 0.0
    high = max(row["high"] for row in rows)
    low = min(row["low"] for row in rows)
    range_pct = ((high - low) / opening * 100) if opening else 0.0
    volume = sum(row["volume"] for row in rows)

    if period_return >= 1:
        direction = "gain, rose, positive momentum, profitable price movement"
    elif period_return <= -1:
        direction = "loss, declined, negative momentum, downside price movement"
    else:
        direction = "flat, stable, sideways price movement"
    volatility = "high volatility" if range_pct >= 5 else "moderate volatility" if range_pct >= 2 else "low volatility"

    start_date = first["timestamp"].date().isoformat()
    end_date = last["timestamp"].date().isoformat()
    line_start = first["line"]
    line_end = last["line"]
    document_id = f"csv:{relative_path}#L{line_start}-L{line_end}"
    company = COMPANY_NAMES.get(ticker, ticker)
    text = (
        f"Simulated {period_type} market prices for {ticker} ({company}) from {start_date} to {end_date}. "
        f"The period opened at {opening:.4f}, closed at {closing:.4f}, returned {period_return:+.2f}%, "
        f"reached a high of {high:.4f} and low of {low:.4f}, with a {range_pct:.2f}% range and "
        f"{volume:,} total volume. Interpretation: {direction}; {volatility}."
    )
    return MarketDocument(
        document_id=document_id,
        text=text,
        metadata={
            "source_type": "csv",
            "source_file": relative_path,
            "ticker": ticker,
            "period_type": period_type,
            "start_date": start_date,
            "end_date": end_date,
            "row_start": line_start,
            "row_end": line_end,
            "open": round(opening, 6),
            "close": round(closing, 6),
            "high": round(high, 6),
            "low": round(low, 6),
            "return_pct": round(period_return, 4),
            "range_pct": round(range_pct, 4),
            "volume": volume,
        },
    )


def build_csv_documents(data_root: Path = DATA_ROOT) -> list[MarketDocument]:
    """Convert only repository CSV files into citation-addressable market chunks."""

    documents: list[MarketDocument] = []
    for path in sorted(data_root.rglob("*.csv")):
        rows = _read_numeric_rows(path)
        if not rows:
            continue
        ticker = _ticker_from_path(path)
        relative_path = path.relative_to(data_root).as_posix()
        if path.name.endswith("_live.csv"):
            grouped: dict[date, list[dict[str, Any]]] = {}
            for row in rows:
                grouped.setdefault(row["timestamp"].date(), []).append(row)
            chunks = [("intraday daily", values) for _, values in sorted(grouped.items())]
        else:
            chunks = [
                ("historical weekly", rows[index : index + HISTORICAL_CHUNK_ROWS])
                for index in range(0, len(rows), HISTORICAL_CHUNK_ROWS)
            ]
        for period_type, chunk_rows in chunks:
            documents.append(
                _describe_chunk(
                    ticker=ticker,
                    relative_path=relative_path,
                    period_type=period_type,
                    rows=chunk_rows,
                )
            )
    return documents


def csv_corpus_fingerprint(data_root: Path = DATA_ROOT) -> str:
    digest = hashlib.sha256()
    paths = sorted(data_root.rglob("*.csv"))
    if not paths:
        raise FileNotFoundError(f"No CSV simulation files found under {data_root}")
    for path in paths:
        digest.update(path.relative_to(data_root).as_posix().encode("utf-8"))
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    return digest.hexdigest()


class CsvMarketVectorStore:
    """SQLite-backed dense vectors with exact cosine search over the small CSV corpus."""

    def __init__(
        self,
        *,
        data_root: Path = DATA_ROOT,
        index_path: Path,
        embedder: EmbeddingBackend,
    ) -> None:
        self.data_root = data_root
        self.index_path = index_path
        self.embedder = embedder
        self._lock = threading.RLock()

    def _index_metadata(self) -> dict[str, str]:
        if not self.index_path.exists():
            return {}
        try:
            with closing(sqlite3.connect(self.index_path)) as connection:
                return dict(connection.execute("SELECT key, value FROM index_metadata"))
        except sqlite3.Error:
            return {}

    def ensure_index(self, *, force: bool = False) -> dict[str, Any]:
        with self._lock:
            fingerprint = csv_corpus_fingerprint(self.data_root)
            metadata = self._index_metadata()
            current = (
                metadata.get("schema_version") == INDEX_SCHEMA_VERSION
                and metadata.get("embedding_model") == self.embedder.name
                and metadata.get("corpus_fingerprint") == fingerprint
            )
            if force or not current:
                self._rebuild(fingerprint)
                metadata = self._index_metadata()
            return {
                "index_path": str(self.index_path),
                "embedding_model": metadata.get("embedding_model", self.embedder.name),
                "corpus_fingerprint": metadata.get("corpus_fingerprint", fingerprint),
                "document_count": int(metadata.get("document_count", "0")),
                "rebuilt": force or not current,
            }

    def _rebuild(self, fingerprint: str) -> None:
        documents = build_csv_documents(self.data_root)
        if not documents:
            raise RuntimeError("CSV simulation corpus produced no vector documents")

        vectors = self.embedder.embed_passages([document.text for document in documents])
        if len(vectors) != len(documents):
            raise RuntimeError("Embedding model returned an unexpected vector count")

        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f"{self.index_path.name}.",
            suffix=".tmp",
            dir=self.index_path.parent,
        )
        os.close(descriptor)
        temporary_path = Path(temporary_name)
        try:
            with closing(sqlite3.connect(temporary_path)) as connection:
                connection.executescript(
                    """
                    CREATE TABLE index_metadata (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    );
                    CREATE TABLE documents (
                        document_id TEXT PRIMARY KEY,
                        text TEXT NOT NULL,
                        metadata_json TEXT NOT NULL,
                        embedding BLOB NOT NULL
                    );
                    CREATE INDEX ix_documents_id ON documents(document_id);
                    """
                )
                rows = []
                dimension = 0
                for document, vector in zip(documents, vectors, strict=True):
                    normalized = _normalize(vector)
                    dimension = len(normalized)
                    rows.append(
                        (
                            document.document_id,
                            document.text,
                            json.dumps(document.metadata, separators=(",", ":")),
                            _pack_vector(normalized),
                        )
                    )
                connection.executemany(
                    "INSERT INTO documents(document_id, text, metadata_json, embedding) VALUES (?, ?, ?, ?)",
                    rows,
                )
                connection.executemany(
                    "INSERT INTO index_metadata(key, value) VALUES (?, ?)",
                    [
                        ("schema_version", INDEX_SCHEMA_VERSION),
                        ("embedding_model", self.embedder.name),
                        ("corpus_fingerprint", fingerprint),
                        ("document_count", str(len(documents))),
                        ("embedding_dimension", str(dimension)),
                    ],
                )
                connection.commit()
            os.replace(temporary_path, self.index_path)
        finally:
            temporary_path.unlink(missing_ok=True)

    def search(
        self,
        query: str,
        *,
        as_of: date,
        tickers: set[str] | None = None,
        limit: int = 8,
    ) -> list[MarketSearchHit]:
        self.ensure_index()
        query_vector = _normalize(self.embedder.embed_query(query))
        requested_tickers = {ticker.upper() for ticker in tickers or set()}
        lowered_query = query.lower()
        prefers_recent = any(
            term in lowered_query
            for term in ("latest", "current", "recent", "today", "now", "momentum", "trend")
        )
        negative_intent = any(
            term in lowered_query
            for term in ("decline", "loss", "losing", "downside", "negative", "worst", "drop", "fall")
        )
        positive_intent = any(
            term in lowered_query
            for term in ("gain", "profit", "profitable", "positive", "best", "rise", "growth")
        )
        high_volatility_intent = any(
            term in lowered_query for term in ("volatile", "volatility", "price swing", "risk")
        )
        high_volume_intent = any(
            term in lowered_query for term in ("high volume", "most volume", "liquid", "liquidity")
        )

        candidates: list[MarketSearchHit] = []
        with closing(sqlite3.connect(self.index_path)) as connection:
            for document_id, text, metadata_json, payload in connection.execute(
                "SELECT document_id, text, metadata_json, embedding FROM documents"
            ):
                metadata = json.loads(metadata_json)
                if metadata["end_date"] > as_of.isoformat():
                    continue
                if requested_tickers and metadata["ticker"] not in requested_tickers:
                    continue
                days_old = max(0, (as_of - date.fromisoformat(metadata["end_date"])).days)
                if prefers_recent and days_old > 45:
                    continue
                vector = _unpack_vector(payload)
                score = sum(left * right for left, right in zip(query_vector, vector, strict=True))
                if prefers_recent:
                    score += 0.08 / (1 + days_old / 14)
                period_return = float(metadata["return_pct"])
                directional_signal = math.tanh(period_return / 5)
                if negative_intent and not positive_intent:
                    score -= 0.24 * directional_signal
                elif positive_intent and not negative_intent:
                    score += 0.24 * directional_signal
                if high_volatility_intent:
                    score += 0.12 * min(float(metadata["range_pct"]) / 10, 1)
                if high_volume_intent:
                    score += 0.06 * min(math.log10(max(int(metadata["volume"]), 1)) / 10, 1)
                candidates.append(
                    MarketSearchHit(
                        document_id=document_id,
                        text=text,
                        score=score,
                        metadata=metadata,
                    )
                )

        candidates.sort(key=lambda item: item.score, reverse=True)
        if requested_tickers:
            return candidates[:limit]

        # Generic market questions benefit from breadth instead of eight near-identical
        # periods for a single ticker.
        selected: list[MarketSearchHit] = []
        per_ticker: dict[str, int] = {}
        for candidate in candidates:
            ticker = candidate.metadata["ticker"]
            if per_ticker.get(ticker, 0) >= 2:
                continue
            selected.append(candidate)
            per_ticker[ticker] = per_ticker.get(ticker, 0) + 1
            if len(selected) >= limit:
                break
        return selected


@lru_cache(maxsize=1)
def get_market_vector_store() -> CsvMarketVectorStore:
    settings = get_settings()
    index_path = Path(settings.assistant_vector_index_path)
    return CsvMarketVectorStore(
        data_root=DATA_ROOT,
        index_path=index_path,
        embedder=FastEmbedBackend(
            model_name=settings.assistant_embedding_model,
            cache_dir=index_path.parent / "models",
        ),
    )
