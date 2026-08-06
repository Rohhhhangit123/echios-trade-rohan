from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Optional, Protocol

from app.config import get_settings
from app.models import TradeException


# ---------- Provider abstraction -------------------------------------------------
class LLMProvider(Protocol):
    async def chat(self, *, system: str, user: str, max_tokens: int,
                   temperature: float) -> str: ...


# ---------- (A) LiteLLM-backed provider (abc.echios.tech / nova / any proxy) -----
@dataclass
class LiteLLMProvider:
    api_base: str
    api_key: str
    model: str

    async def chat(self, *, system: str, user: str, max_tokens: int,
                   temperature: float) -> str:
        try:
            import litellm
        except ImportError as e:  # pragma: no cover
            raise GenaiNotConfiguredError(
                "litellm package not installed. pip install litellm or add to requirements.txt"
            ) from e

        litellm.api_base = self.api_base
        litellm.api_key = self.api_key
        # LiteLLM proxy routes are typically prefixed /v1; the SDK handles this
        # automatically. If your proxy needs a custom api_version or custom_llm_provider,
        # set them via litellm.drop_params or the completion kwargs.
        resp = await litellm.acompletion(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if not resp or not resp.choices:
            raise RuntimeError(f"LiteLLM empty response for model={self.model}")
        content = resp.choices[0].message.content or ""
        return content


# ---------- (B) Native Anthropic provider (fallback if LiteLLM not configured) ---
@dataclass
class AnthropicProvider:
    api_key: str
    model: str = "claude-3-5-sonnet-20241022"

    async def chat(self, *, system: str, user: str, max_tokens: int,
                   temperature: float) -> str:
        try:
            from anthropic import AsyncAnthropic
        except ImportError as e:  # pragma: no cover
            raise GenaiNotConfiguredError("anthropic SDK not installed") from e
        client = AsyncAnthropic(api_key=self.api_key)
        resp = await client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return resp.content[0].text if resp.content else ""


# ---------- Configuration + provider selection -----------------------------------
PARSE_ORDER_SYSTEM = (
    "You are a trade-order parsing assistant for an STP trading platform. "
    "Parse natural-language order instructions into strict structured data. "
    "Return ONLY valid JSON matching this schema: "
    '{"instrument": str ticker, "side": "BUY"|"SELL", "quantity": number, '
    '"price": number|null, "at_market": bool, "currency": str 3-letter, '
    '"confidence": 0..1, "notes": string human-readable summary}. '
    "Use price=null + at_market=true for orders specified 'at market'. "
    "If you cannot parse any field, leave it null and reduce confidence. "
    "Do NOT invent tickers; if the instrument is ambiguous use null and flag in notes."
)

EXPLAIN_EXCEPTION_SYSTEM = (
    "You are a senior trade operations analyst explaining a pipeline exception. "
    "Answer in 3 short sections, each on its own line, prefixed with the exact "
    "label: summary: <text> / likely_root_cause: <text> / suggested_fix: <text>. "
    "Keep total under 200 words. Be concrete, actionable, specific to the data."
)

RISK_DAILY_SUMMARY_SYSTEM = (
    "You are a senior risk operations analyst writing a short daily briefing for a "
    "trading desk's Head of Risk. You are given real aggregated numbers from the "
    "firm's STP (straight-through processing) pipeline. Write 3-5 sentences, plain "
    "prose (no headers, no bullet points), covering: how the day is going overall, "
    "the single biggest problem area, and one concrete recommended action. Be "
    "specific and reference the actual numbers given. Do not invent numbers or "
    "facts not present in the data. Do not add a greeting or sign-off."
)


class GenaiNotConfiguredError(RuntimeError):
    pass


def _provider() -> LLMProvider:
    s = get_settings()
    # --- Prefer LiteLLM proxy if configured ---
    base = (s.litellm_api_base or "").strip()
    key = (s.litellm_api_key or "").strip()
    model = (s.litellm_model or "").strip()
    if base and key and model:
        return LiteLLMProvider(api_base=base, api_key=key, model=model)

    # --- Fallback: native Anthropic ---
    akey = (s.anthropic_api_key or "").strip()
    if akey and not akey.startswith("PASTE_") and not akey.startswith("sk-ant-xxx"):
        return AnthropicProvider(api_key=akey)

    raise GenaiNotConfiguredError(
        "No LLM provider configured. Set either (LITELLM_API_BASE + LITELLM_API_KEY + LITELLM_MODEL) "
        "or ANTHROPIC_API_KEY in backend/.env. GenAI endpoints disabled."
    )


# ---------- Public API (same contract as before, routers untouched) --------------
async def parse_order(prompt: str, default_client_id: Optional[int] = None) -> dict:
    prov = _provider()
    msg = (
        f"Context: default_client_id={default_client_id}\n"
        f"Order text: {prompt}\n\n"
        "JSON output:"
    )
    raw = await prov.chat(
        system=PARSE_ORDER_SYSTEM, user=msg,
        max_tokens=400, temperature=0.0,
    )
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            parsed = json.loads(raw[start:end + 1])
        else:
            parsed = {"confidence": 0.0, "notes": f"Failed to parse JSON: {raw[:200]}"}
    parsed.setdefault("confidence", 0.0)
    return {"parsed": parsed, "raw_summary": raw}


async def explain_exception(exc: TradeException) -> dict:
    prov = _provider()
    context = (
        f"Exception id={exc.id} trade_id={exc.trade_id} stage={exc.stage.value}\n"
        f"reason={exc.reason}\n"
        f"breaking_field={exc.breaking_field or '(none)'}\n"
        f"status={exc.status.value}\n"
        "Reply with the 3 labeled lines as described."
    )
    raw = await prov.chat(
        system=EXPLAIN_EXCEPTION_SYSTEM, user=context,
        max_tokens=600, temperature=0.2,
    )
    sections = {"summary": "", "likely_root_cause": "", "suggested_fix": ""}
    current = "summary"
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        lower = stripped.lower()
        if lower.startswith("summary:"):
            current = "summary"
            sections[current] += stripped.split(":", 1)[1].strip() + " "
            continue
        if lower.startswith("likely_root_cause:") or "likely root cause:" in lower:
            current = "likely_root_cause"
            sections[current] += stripped.split(":", 1)[1].strip() + " "
            continue
        if lower.startswith("suggested_fix:") or "suggested fix:" in lower:
            current = "suggested_fix"
            sections[current] += stripped.split(":", 1)[1].strip() + " "
            continue
        sections[current] += stripped + " "
    sections = {k: v.strip() for k, v in sections.items()}
    if not sections["summary"]:
        sections["summary"] = raw[:200]
    sections["raw"] = raw
    return sections


async def risk_daily_summary(control_tower: dict) -> str:
    prov = _provider()
    stages = control_tower.get("top_failing_stages") or []
    clients = control_tower.get("top_failing_clients") or []
    stage_lines = ", ".join(f"{s['stage']}={s['count']}" for s in stages) or "none open"
    client_lines = (
        ", ".join(f"{c.get('client_name') or c['client_id']}={c['count']}" for c in clients)
        or "none"
    )
    context = (
        f"STP rate: {control_tower['stp_rate']}% ({control_tower['done_trades']}/"
        f"{control_tower['total_trades']} trades completed cleanly)\n"
        f"Open exceptions: {control_tower['open_exceptions']}\n"
        f"Exception rate: {control_tower['exception_rate']}%\n"
        f"Average resolution time: {control_tower['avg_resolution_minutes']} minutes\n"
        f"Exceptions raised today: {control_tower['exceptions_today']} "
        f"(yesterday: {control_tower['exceptions_yesterday']})\n"
        f"Top failing stages (open exceptions by stage): {stage_lines}\n"
        f"Top clients by open exceptions: {client_lines}\n"
    )
    raw = await prov.chat(
        system=RISK_DAILY_SUMMARY_SYSTEM, user=context,
        max_tokens=350, temperature=0.2,
    )
    return raw.strip()
