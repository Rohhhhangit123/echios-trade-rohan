from __future__ import annotations

import asyncio
import unittest
from datetime import date

from app.services.assistant_citations import CitationRecord
from app.services.assistant_retrieval import build_assistant_context
from app.services.assistant_user_repository import AssistantUserData
from app.services.market_vector_store import MarketSearchHit


class FakeUserRepository:
    async def load(self, *, client_id: int, include_history: bool) -> AssistantUserData:
        citations = {
            "db:client_accounts:1": CitationRecord(
                id="db:client_accounts:1",
                source_type="database",
                label="Supabase database",
                detail="client_accounts row id=1",
                table="client_accounts",
                record_ids=[1],
            ),
            "db:positions:10": CitationRecord(
                id="db:positions:10",
                source_type="database",
                label="Supabase database",
                detail="positions row id=10",
                table="positions",
                record_ids=[10],
            ),
            "db:trades:20": CitationRecord(
                id="db:trades:20",
                source_type="database",
                label="Supabase database",
                detail="trades row id=20",
                table="trades",
                record_ids=[20],
            ),
        }
        return AssistantUserData(
            client={
                "id": 1,
                "name": "Test Client",
                "kyc_status": "VERIFIED",
                "nostro_balance": "1000",
                "citation_ids": ["db:client_accounts:1"],
            },
            positions=[
                {
                    "position_id": 10,
                    "client_id": 1,
                    "instrument": "AAPL",
                    "quantity": "10",
                    "average_price": "100",
                    "updated_at": "2026-08-01T00:00:00",
                    "citation_ids": ["db:positions:10"],
                }
            ],
            trades=[
                {
                    "trade_id": 20,
                    "instrument": "AAPL",
                    "side": "BUY",
                    "quantity": "10",
                    "filled_quantity": "10",
                    "trade_price": "100",
                    "status": "DONE",
                    "simulated_trade": False,
                    "created_at": "2026-08-01T00:00:00",
                    "citation_ids": ["db:trades:20"],
                }
            ],
            open_exception_ids=[],
            open_exception_citation_id="db:exceptions:open-client:1",
            recent_exceptions=[],
            ledger_entries=[],
            trade_history=[],
            citations=citations,
        )


class FakeEmbedder:
    name = "fake-semantic-model"


class FakeVectorStore:
    embedder = FakeEmbedder()

    def search(self, query, *, as_of, tickers, limit):
        return [
            MarketSearchHit(
                document_id="csv:prices/AAPL.csv#L2-L10",
                text="Apple had positive simulated momentum.",
                score=0.82,
                metadata={
                    "source_type": "csv",
                    "source_file": "prices/AAPL.csv",
                    "ticker": "AAPL",
                    "period_type": "intraday daily",
                    "start_date": "2026-08-01",
                    "end_date": "2026-08-01",
                    "row_start": 2,
                    "row_end": 10,
                },
            )
        ]


class AssistantContextTests(unittest.TestCase):
    def test_context_combines_database_and_semantic_csv_citations(self) -> None:
        client, context, citations = asyncio.run(
            build_assistant_context(
                None,  # type: ignore[arg-type]
                client_id=1,
                question="Which Apple trade is most profitable?",
                as_of=date(2026, 8, 4),
                user_repository=FakeUserRepository(),
                vector_store=FakeVectorStore(),  # type: ignore[arg-type]
            )
        )

        citation_ids = {citation.id for citation in citations}
        self.assertEqual(client["name"], "Test Client")
        self.assertEqual(context["retrieval"]["corpus"], "CSV files only")
        self.assertIn("db:trades:20", citation_ids)
        self.assertIn("db:positions:10", citation_ids)
        self.assertIn("csv:prices/AAPL.csv#L2-L10", citation_ids)
        profitable = context["most_profitable_trade_estimates"][0]
        self.assertIn("db:trades:20", profitable["citation_ids"])
        self.assertTrue(any(citation_id.startswith("csv:") for citation_id in profitable["citation_ids"]))


if __name__ == "__main__":
    unittest.main()
