from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.models import TradeException
from app.schemas import (
    AssistantChatRequest,
    AssistantChatResponse,
    GenaiExplainExceptionResponse,
    GenaiParseOrderRequest,
    GenaiParseOrderResponse,
)
from app.services.assistant_retrieval import build_assistant_context
from app.services.assistant_service import answer_question
from app.services.genai_service import GenaiNotConfiguredError, explain_exception, parse_order

router = APIRouter(prefix="/genai", tags=["genai"])

@router.post("/parse-order", response_model=GenaiParseOrderResponse)
async def genai_parse_order(body: GenaiParseOrderRequest) -> GenaiParseOrderResponse:
    try:
        result = await parse_order(body.prompt, default_client_id=body.default_client_id)
    except GenaiNotConfiguredError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Claude API error: {e}")
    return GenaiParseOrderResponse(**result)


@router.post("/explain-exception/{exception_id}", response_model=GenaiExplainExceptionResponse)
async def genai_explain_exception(
    exception_id: int,
    db: AsyncSession = Depends(get_db),
) -> GenaiExplainExceptionResponse:
    exc: TradeException | None = await db.get(TradeException, exception_id)
    if exc is None:
        raise HTTPException(status_code=404, detail=f"Exception {exception_id} not found")
    try:
        sections = await explain_exception(exc)
    except GenaiNotConfiguredError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Claude API error: {e}")
    return GenaiExplainExceptionResponse(**sections)


@router.post("/assistant", response_model=AssistantChatResponse)
async def genai_assistant(
    body: AssistantChatRequest,
    db: AsyncSession = Depends(get_db),
) -> AssistantChatResponse:
    # Resolve client identity server-side; never accept an arbitrary client_id from the browser.
    settings = get_settings()
    as_of = settings.simulation_as_of or date.today()
    try:
        client, context, citations = await build_assistant_context(
            db,
            client_id=settings.assistant_client_id,
            question=body.message,
            as_of=as_of,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        result = await answer_question(
            message=body.message,
            history=[item.model_dump() for item in body.history],
            context=context,
            citations=citations,
        )
    except GenaiNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"Anthropic assistant error: {exc}") from exc

    return AssistantChatResponse(
        client_id=client["id"],
        client_name=client["name"],
        **result,
    )
