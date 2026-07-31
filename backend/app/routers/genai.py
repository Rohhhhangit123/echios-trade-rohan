from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import TradeException
from app.schemas import (
    GenaiExplainExceptionResponse,
    GenaiParseOrderRequest,
    GenaiParseOrderResponse,
)
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
