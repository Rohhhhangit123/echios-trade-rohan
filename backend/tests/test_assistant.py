from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

from app.services.assistant_retrieval import market_snapshot, relevant_news
from app.services.assistant_service import _compact_text, _extract_json, answer_question


class AssistantRetrievalTests(unittest.TestCase):
    def test_market_snapshot_respects_as_of_date(self) -> None:
        snapshot = market_snapshot("AAPL", date(2026, 8, 4))
        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertTrue(snapshot["as_of"].startswith("2026-08-04"))
        self.assertEqual(snapshot["source"], "simulated_price_csv")

    def test_googl_uses_goog_simulation_file(self) -> None:
        snapshot = market_snapshot("GOOGL", date(2026, 8, 4))
        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertEqual(snapshot["simulation_ticker"], "GOOG")

    def test_news_is_filtered_to_ticker_and_date(self) -> None:
        articles = relevant_news({"AAPL"}, date(2026, 8, 4), limit=4)
        self.assertGreater(len(articles), 0)
        self.assertLessEqual(len(articles), 4)
        self.assertTrue(all(article["ticker"] == "AAPL" for article in articles))
        self.assertTrue(all(article["published_at"][:10] <= "2026-08-04" for article in articles))


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
        self.assertEqual(compact, "One two three four…")

    def test_provider_response_is_parsed_without_network_access(self) -> None:
        class FakeProvider:
            async def chat(self, **kwargs):
                self.request = kwargs
                return (
                    '{"summary":"AAPL leads",'
                    '"insights":["Estimated gain is simulated"],'
                    '"suggestions":["Review concentration"]}'
                )

        fake_provider = FakeProvider()
        with patch("app.services.assistant_service._provider", return_value=fake_provider):
            import asyncio

            result = asyncio.run(
                answer_question(
                    message="Which trade leads?",
                    history=[],
                    context={"positions": [{"instrument": "AAPL"}]},
                )
            )

        self.assertEqual(result["summary"], "AAPL leads")
        self.assertIn("Retrieved context", fake_provider.request["user"])
        self.assertEqual(fake_provider.request["temperature"], 0.2)
        self.assertEqual(fake_provider.request["max_tokens"], 500)


if __name__ == "__main__":
    unittest.main()
