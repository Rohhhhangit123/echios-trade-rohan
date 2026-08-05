from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

from app.services.assistant_citations import CitationRecord
from app.services.assistant_retrieval import market_snapshot, relevant_news
from app.services.assistant_service import _compact_text, _extract_json, answer_question


class AssistantRetrievalTests(unittest.TestCase):
    def test_market_snapshot_respects_as_of_date(self) -> None:
        snapshot = market_snapshot("AAPL", date(2026, 8, 4))
        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertTrue(snapshot["as_of"].startswith("2026-08-04"))
        self.assertEqual(snapshot["source"], "simulated_price_csv")
        self.assertEqual(snapshot["row_start"], snapshot["row_end"])
        self.assertTrue(snapshot["citation_ids"][0].startswith("csv:"))

    def test_googl_uses_goog_simulation_file(self) -> None:
        snapshot = market_snapshot("GOOGL", date(2026, 8, 4))
        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertEqual(snapshot["simulation_ticker"], "GOOG")

    def test_news_is_filtered_to_ticker_date_and_has_source_identity(self) -> None:
        articles = relevant_news({"AAPL"}, date(2026, 8, 4), limit=4)
        self.assertGreater(len(articles), 0)
        self.assertLessEqual(len(articles), 4)
        self.assertTrue(all(article["ticker"] == "AAPL" for article in articles))
        self.assertTrue(all(article["published_at"][:10] <= "2026-08-04" for article in articles))
        self.assertTrue(all(article["citation_ids"][0].startswith("json:") for article in articles))


class AssistantResponseParsingTests(unittest.TestCase):
    def test_extracts_json_from_wrapped_model_output(self) -> None:
        parsed = _extract_json(
            'Result: {"summary":"Answer", "insights":["One"], "suggestions":[]} end'
        )
        self.assertEqual(parsed["summary"], "Answer")
        self.assertEqual(parsed["insights"], ["One"])

    def test_falls_back_to_raw_text(self) -> None:
        parsed = _extract_json("plain answer")
        self.assertEqual(parsed["summary"], "plain answer")

    def test_compacts_long_model_text(self) -> None:
        compact = _compact_text("**One two three four five six**", max_words=4)
        self.assertEqual(compact, "One two three four...")

    def test_provider_response_has_validated_claim_level_citations(self) -> None:
        class FakeProvider:
            async def chat(self, **kwargs):
                self.request = kwargs
                return (
                    '{"summary":{"text":"AAPL leads","citation_ids":["db:trades:7"]},'
                    '"insights":[{"text":"Estimated gain is simulated",'
                    '"citation_ids":["csv:prices.csv#L2-L3"]}],'
                    '"suggestions":[{"text":"Review concentration","citation_ids":[]}]}'
                )

        fake_provider = FakeProvider()
        citations = [
            CitationRecord(
                id="db:trades:7",
                source_type="database",
                label="Supabase database",
                detail="trades row id=7",
                table="trades",
                record_ids=[7],
            ),
            CitationRecord(
                id="csv:prices.csv#L2-L3",
                source_type="csv",
                label="Semantic CSV retrieval",
                detail="prices.csv rows 2-3",
                source_file="prices.csv",
                row_start=2,
                row_end=3,
            ),
        ]
        with patch("app.services.assistant_service._provider", return_value=fake_provider):
            import asyncio

            result = asyncio.run(
                answer_question(
                    message="Which trade leads?",
                    history=[],
                    context={
                        "most_profitable_trade_estimates": [
                            {"trade_id": 7, "citation_ids": ["db:trades:7"]}
                        ],
                        "semantic_market_context": [
                            {"citation_id": "csv:prices.csv#L2-L3"}
                        ],
                    },
                    citations=citations,
                )
            )

        self.assertEqual(result["summary"]["text"], "AAPL leads")
        self.assertEqual(result["summary"]["citation_ids"], ["db:trades:7"])
        self.assertEqual(len(result["citations"]), 2)
        self.assertIn("Retrieved context", fake_provider.request["user"])
        self.assertIn("Allowed citation catalog", fake_provider.request["user"])
        self.assertEqual(fake_provider.request["temperature"], 0.1)
        self.assertEqual(fake_provider.request["max_tokens"], 600)

    def test_unknown_model_citations_are_replaced_with_retrieval_defaults(self) -> None:
        class FakeProvider:
            async def chat(self, **kwargs):
                return (
                    '{"summary":{"text":"Trade 7 leads","citation_ids":["made-up"]},'
                    '"insights":[],"suggestions":[]}'
                )

        citation = CitationRecord(
            id="db:trades:7",
            source_type="database",
            label="Supabase database",
            detail="trades row id=7",
            table="trades",
            record_ids=[7],
        )
        with patch("app.services.assistant_service._provider", return_value=FakeProvider()):
            import asyncio

            result = asyncio.run(
                answer_question(
                    message="Which trade is most profitable?",
                    history=[],
                    context={
                        "most_profitable_trade_estimates": [
                            {"trade_id": 7, "citation_ids": [citation.id]}
                        ]
                    },
                    citations=[citation],
                )
            )

        self.assertEqual(result["summary"]["citation_ids"], [citation.id])
        self.assertEqual(result["citations"][0]["record_ids"], [7])

    def test_grouped_exception_claim_uses_one_aggregate_citation(self) -> None:
        class FakeProvider:
            async def chat(self, **kwargs):
                return (
                    '{"summary":{"text":"Two exceptions remain open",'
                    '"citation_ids":["db:exceptions:4","db:exceptions:6"]},'
                    '"insights":[],"suggestions":[]}'
                )

        citations = [
            CitationRecord(
                id=f"db:exceptions:{record_id}",
                source_type="database",
                label="Supabase database",
                detail=f"exceptions row id={record_id}",
                table="exceptions",
                record_ids=[record_id],
            )
            for record_id in (4, 6)
        ]
        aggregate = CitationRecord(
            id="db:exceptions:open-client:1",
            source_type="database",
            label="Supabase database",
            detail="exceptions rows ids=[4, 6]; client_id=1, status=OPEN, count=2",
            table="exceptions",
            record_ids=[4, 6],
        )
        citations.append(aggregate)

        with patch("app.services.assistant_service._provider", return_value=FakeProvider()):
            import asyncio

            result = asyncio.run(
                answer_question(
                    message="How many exceptions are open?",
                    history=[],
                    context={
                        "open_exception_count": {
                            "value": 2,
                            "citation_ids": [aggregate.id],
                        }
                    },
                    citations=citations,
                )
            )

        self.assertEqual(result["summary"]["citation_ids"], [aggregate.id])
        self.assertEqual([item["id"] for item in result["citations"]], [aggregate.id])


if __name__ == "__main__":
    unittest.main()
