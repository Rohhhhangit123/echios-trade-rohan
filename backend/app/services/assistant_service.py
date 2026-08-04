from __future__ import annotations

import json
from typing import Any

from app.services.genai_service import _provider


ASSISTANT_SYSTEM = """You are Echios Assistant, a concise financial operations analyst.
Use only the retrieved context supplied with the latest user message. Never invent account data,
prices, news, returns, or facts. Database data is private to the selected client. Market prices and
news in context are simulations and must always be labeled simulated, never live or real-world.
Trade P&L values are comparison estimates, not realized accounting P&L. When asked for investment
tips, give balanced educational considerations grounded in the supplied simulated evidence; do not
promise returns or issue definitive buy/sell instructions.

Return ONLY valid JSON with this exact shape:
{"summary":"short direct answer", "insights":["specific evidence-backed point"],
 "suggestions":["optional practical or educational next step"]}
Keep the response extremely scannable:
- summary: exactly 1 sentence, at most 30 words
- insights: 2 or 3 items, each at most 18 words; lead with the metric or instrument
- suggestions: 0 to 2 items, each at most 18 words
- do not repeat facts between sections
Use plain text, not Markdown, inside each string.
"""


def _extract_json(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start < 0 or end <= start:
            return {"summary": raw.strip(), "insights": [], "suggestions": []}
        try:
            parsed = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            return {"summary": raw.strip(), "insights": [], "suggestions": []}
    if not isinstance(parsed, dict):
        return {"summary": raw.strip(), "insights": [], "suggestions": []}
    return parsed


def _compact_text(value: Any, *, max_words: int) -> str:
    text = " ".join(str(value or "").replace("**", "").split()).strip(" •-")
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]).rstrip(".,;:") + "…"


def _clean_list(value: Any, *, limit: int, max_words: int) -> list[str]:
    if not isinstance(value, list):
        return []
    items = [_compact_text(item, max_words=max_words) for item in value[:limit]]
    return [item for item in items if item]


async def answer_question(
    *,
    message: str,
    history: list[dict[str, str]],
    context: dict[str, Any],
) -> dict[str, Any]:
    provider = _provider()
    conversation = "\n".join(
        f"{item['role'].upper()}: {item['content']}" for item in history[-8:]
    )
    prompt = (
        f"Previous browser-session conversation:\n{conversation or '(none)'}\n\n"
        f"Current question: {message}\n\n"
        "Retrieved context (authoritative JSON):\n"
        f"{json.dumps(context, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "JSON output:"
    )
    raw = await provider.chat(
        system=ASSISTANT_SYSTEM,
        user=prompt,
        max_tokens=500,
        temperature=0.2,
    )
    parsed = _extract_json(raw)
    summary = _compact_text(
        parsed.get("summary") or raw or "No answer was returned.",
        max_words=35,
    )
    return {
        "summary": summary,
        "insights": _clean_list(parsed.get("insights"), limit=3, max_words=22),
        "suggestions": _clean_list(parsed.get("suggestions"), limit=2, max_words=22),
    }
