from __future__ import annotations

import csv
import tempfile
import unittest
from datetime import date
from pathlib import Path

from app.services.market_vector_store import CsvMarketVectorStore, build_csv_documents


class KeywordEmbedder:
    name = "test-keyword-embeddings"
    vocabulary = ("apple", "microsoft", "gain", "loss", "volatile", "volume")

    def _embed(self, text: str) -> list[float]:
        lowered = text.lower()
        return [float(lowered.count(term)) for term in self.vocabulary]

    def embed_passages(self, texts):
        return [self._embed(text) for text in texts]

    def embed_query(self, text):
        return self._embed(text)


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["timestamp", "open", "high", "low", "close", "volume"],
        )
        writer.writeheader()
        writer.writerows(rows)


class MarketVectorStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "data"
        write_csv(
            self.root / "prices" / "simulated_AAPL_live.csv",
            [
                {
                    "timestamp": "2026-08-01 09:30:00",
                    "open": 100,
                    "high": 112,
                    "low": 99,
                    "close": 111,
                    "volume": 1000,
                },
                {
                    "timestamp": "2026-08-01 09:31:00",
                    "open": 111,
                    "high": 116,
                    "low": 110,
                    "close": 115,
                    "volume": 1200,
                },
            ],
        )
        write_csv(
            self.root / "prices" / "simulated_MSFT_live.csv",
            [
                {
                    "timestamp": "2026-08-01 09:30:00",
                    "open": 200,
                    "high": 201,
                    "low": 175,
                    "close": 180,
                    "volume": 5000,
                },
                {
                    "timestamp": "2026-08-01 09:31:00",
                    "open": 180,
                    "high": 182,
                    "low": 170,
                    "close": 172,
                    "volume": 6000,
                },
            ],
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_csv_documents_have_precise_row_citations(self) -> None:
        documents = build_csv_documents(self.root)
        self.assertEqual(len(documents), 2)
        self.assertTrue(all(document.document_id.endswith("#L2-L3") for document in documents))
        self.assertTrue(all(document.metadata["source_type"] == "csv" for document in documents))

    def test_exact_cosine_search_returns_matching_decline(self) -> None:
        store = CsvMarketVectorStore(
            data_root=self.root,
            index_path=Path(self.temp.name) / "vectors.sqlite3",
            embedder=KeywordEmbedder(),
        )
        status = store.ensure_index()
        hits = store.search(
            "Microsoft loss and negative downside",
            as_of=date(2026, 8, 2),
            limit=2,
        )

        self.assertEqual(status["document_count"], 2)
        self.assertEqual(hits[0].metadata["ticker"], "MSFT")
        self.assertGreater(hits[0].score, hits[1].score)

    def test_as_of_and_ticker_filters_are_applied_before_ranking(self) -> None:
        store = CsvMarketVectorStore(
            data_root=self.root,
            index_path=Path(self.temp.name) / "vectors.sqlite3",
            embedder=KeywordEmbedder(),
        )
        store.ensure_index()
        self.assertEqual(
            store.search("gain", as_of=date(2026, 7, 31), tickers={"AAPL"}),
            [],
        )
        hits = store.search("gain", as_of=date(2026, 8, 2), tickers={"AAPL"})
        self.assertTrue(hits)
        self.assertTrue(all(hit.metadata["ticker"] == "AAPL" for hit in hits))


if __name__ == "__main__":
    unittest.main()
