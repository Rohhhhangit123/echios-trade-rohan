from __future__ import annotations

import json
from typing import Any

from app.services.assistant_citations import CitationRecord
from app.services.genai_service import _provider


ASSISTANT_SYSTEM = """You are Echios Assistant, a concise financial operations analyst.
Use only the retrieved context supplied with the latest user message. Never invent account data,
prices, news, returns, or facts. Database data is private to the selected client. Market prices and
news in context are simulations and must always be labeled simulated, never live or real-world.
Trade P&L values are comparison estimates, not realized accounting P&L. When asked for investment
tips, give clear, balanced considerations grounded in the supplied evidence. Distinguish facts from
judgment and never guarantee returns.

Every factual claim must cite the exact citation_ids attached to the supporting context records.
Never create a citation ID and never cite a record that does not support the claim.

Return ONLY valid JSON with this exact shape:
{"summary":{"text":"short direct answer","citation_ids":["exact supplied ID"]},
 "insights":[{"text":"specific evidence-backed point","citation_ids":["exact supplied ID"]}],
 "suggestions":[{"text":"optional practical portfolio next step","citation_ids":[]}]}
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
    return " ".join(words[:max_words]).rstrip(".,;:") + "..."


def _context_ids(value: Any) -> list[str]:
    ids: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "citation_id" and isinstance(item, str):
                ids.append(item)
            elif key == "citation_ids" and isinstance(item, list):
                ids.extend(str(entry) for entry in item)
            else:
                ids.extend(_context_ids(item))
    elif isinstance(value, list):
        for item in value:
            ids.extend(_context_ids(item))
    return list(dict.fromkeys(ids))


def _default_citation_ids(message: str, context: dict[str, Any]) -> list[str]:
    lowered = message.lower()
    sections: list[Any]
    limit = 4
    if any(term in lowered for term in ("exception", "reconciliation", "failed", "failure")):
        sections = [context.get("open_exception_count", {}), context.get("recent_exceptions", [])]
        limit = 20
    elif any(term in lowered for term in ("profit", "gain", "best trade", "losing trade", "loss")):
        sections = [
            context.get("most_profitable_trade_estimates", []),
            context.get("largest_trade_loss_estimates", []),
        ]
    elif any(term in lowered for term in ("portfolio", "position", "holding", "risk", "concentration")):
        sections = [context.get("positions", []), context.get("semantic_market_context", [])]
    elif any(term in lowered for term in ("cash", "ledger", "nostro", "balance")):
        sections = [context.get("client", {}), context.get("ledger_summary", [])]
    elif any(term in lowered for term in ("history", "lifecycle", "stage", "progress")):
        sections = [context.get("trade_history", []), context.get("recent_trades", [])]
    elif any(term in lowered for term in ("news", "headline", "sentiment", "outlook")):
        sections = [context.get("simulated_news", []), context.get("semantic_market_context", [])]
    else:
        sections = [context.get("semantic_market_context", []), context.get("client", {})]
    return _context_ids(sections)[:limit]


def _claim(
    value: Any,
    *,
    allowed_ids: set[str],
    fallback_ids: list[str],
    max_words: int,
    require_citation: bool,
) -> dict[str, Any]:
    if isinstance(value, dict):
        text = _compact_text(value.get("text"), max_words=max_words)
        raw_ids = value.get("citation_ids", [])
    else:
        text = _compact_text(value, max_words=max_words)
        raw_ids = []
    citation_ids = []
    if isinstance(raw_ids, list):
        citation_ids = list(
            dict.fromkeys(str(citation_id) for citation_id in raw_ids if str(citation_id) in allowed_ids)
        )
    if require_citation and text and not citation_ids:
        citation_ids = [citation_id for citation_id in fallback_ids if citation_id in allowed_ids]
    return {"text": text, "citation_ids": citation_ids}


def _claim_list(
    value: Any,
    *,
    limit: int,
    max_words: int,
    allowed_ids: set[str],
    fallback_ids: list[str],
    context: dict[str, Any],
    require_citation: bool,
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    claims = []
    for item in value[:limit]:
        raw_text = item.get("text") if isinstance(item, dict) else item
        claim_fallback_ids = _default_citation_ids(str(raw_text or ""), context)
        claims.append(
            _claim(
                item,
                allowed_ids=allowed_ids,
                fallback_ids=claim_fallback_ids or fallback_ids,
                max_words=max_words,
                require_citation=require_citation,
            )
        )
    return [claim for claim in claims if claim["text"]]


def _collapse_grouped_citations(
    claim: dict[str, Any], citations_by_id: dict[str, CitationRecord]
) -> dict[str, Any]:
    """Prefer one exact aggregate source over many rows for the same grouped fact."""
    citation_ids = claim["citation_ids"]
    exception_ids = [
        citation_id
        for citation_id in citation_ids
        if citations_by_id[citation_id].table == "exceptions"
        and len(citations_by_id[citation_id].record_ids) == 1
    ]
    aggregates = [
        citation
        for citation in citations_by_id.values()
        if citation.table == "exceptions" and len(citation.record_ids) > 1
    ]
    if len(exception_ids) < 2 and not any(
        citation_id in citation_ids for citation_id in (item.id for item in aggregates)
    ):
        return claim

    cited_record_ids = {
        record_id
        for citation_id in exception_ids
        for record_id in citations_by_id[citation_id].record_ids
    }
    aggregate = next(
        (
            item
            for item in aggregates
            if cited_record_ids.issubset(set(item.record_ids))
            and (cited_record_ids or item.id in citation_ids)
        ),
        None,
    )
    if aggregate is None:
        return claim

    collapsed_ids: list[str] = []
    aggregate_added = False
    for citation_id in citation_ids:
        citation = citations_by_id[citation_id]
        is_covered_exception = (
            citation.table == "exceptions"
            and set(citation.record_ids).issubset(set(aggregate.record_ids))
        )
        if is_covered_exception:
            if not aggregate_added:
                collapsed_ids.append(aggregate.id)
                aggregate_added = True
        else:
            collapsed_ids.append(citation_id)
    return {**claim, "citation_ids": collapsed_ids}


async def answer_question(
    *,
    message: str,
    history: list[dict[str, str]],
    context: dict[str, Any],
    citations: list[CitationRecord],
) -> dict[str, Any]:
    provider = _provider()
    conversation = "\n".join(
        f"{item['role'].upper()}: {item['content']}" for item in history[-8:]
    )
    allowed_ids = {citation.id for citation in citations}
    citation_catalog = [citation.as_dict() for citation in citations]
    prompt = (
        f"Previous browser-session conversation:\n{conversation or '(none)'}\n\n"
        f"Current question: {message}\n\n"
        "Retrieved context (authoritative JSON):\n"
        f"{json.dumps(context, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Allowed citation catalog (use IDs exactly as written):\n"
        f"{json.dumps(citation_catalog, ensure_ascii=False, separators=(',', ':'))}\n\n"
        "JSON output:"
    )
    raw = await provider.chat(
        system=ASSISTANT_SYSTEM,
        user=prompt,
        max_tokens=600,
        temperature=0.1,
    )
    parsed = _extract_json(raw)
    fallback_ids = _default_citation_ids(message, context)
    summary = _claim(
        parsed.get("summary") or raw or "No answer was returned.",
        allowed_ids=allowed_ids,
        fallback_ids=fallback_ids,
        max_words=35,
        require_citation=True,
    )
    insights = _claim_list(
        parsed.get("insights"),
        limit=3,
        max_words=22,
        allowed_ids=allowed_ids,
        fallback_ids=fallback_ids,
        context=context,
        require_citation=True,
    )
    suggestions = _claim_list(
        parsed.get("suggestions"),
        limit=2,
        max_words=22,
        allowed_ids=allowed_ids,
        fallback_ids=fallback_ids,
        context=context,
        require_citation=True,
    )
    citations_by_id = {citation.id: citation for citation in citations}
    summary = _collapse_grouped_citations(summary, citations_by_id)
    insights = [_collapse_grouped_citations(claim, citations_by_id) for claim in insights]
    suggestions = [
        _collapse_grouped_citations(claim, citations_by_id) for claim in suggestions
    ]
    referenced_ids = {
        citation_id
        for claim in [summary, *insights, *suggestions]
        for citation_id in claim["citation_ids"]
    }
    return {
        "summary": summary,
        "insights": insights,
        "suggestions": suggestions,
        "citations": [
            citation.as_dict() for citation in citations if citation.id in referenced_ids
        ],
    }
