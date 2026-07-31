from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import (
    ClientAccount,
    ExceptionStatus,
    Trade,
    TradeException,
)
from app.pipeline import resolve_exception_and_rerun
from app.schemas import (
    ExceptionResolveRequest,
    ExceptionResponse,
    TradeResponse,
)
from app.routers.trades import _trade_to_response

router = APIRouter(prefix="/exceptions", tags=["exceptions"])


def _exc_to_response(
    exc: TradeException,
    instrument: Optional[str] = None,
    client_name: Optional[str] = None,
) -> ExceptionResponse:
    r = ExceptionResponse.model_validate(exc)
    if instrument:
        r.trade_instrument = instrument
    if client_name:
        r.trade_client_name = client_name
    return r


@router.get("", response_model=list[ExceptionResponse])
async def list_exceptions(
    status: ExceptionStatus = Query(default=ExceptionStatus.OPEN),
    stage: Optional[str] = Query(default=None),
    trade_id: Optional[int] = Query(default=None, gt=0),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[ExceptionResponse]:
    conditions = [TradeException.status == status]
    if stage:
        conditions.append(TradeException.stage == stage.upper())
    if trade_id:
        conditions.append(TradeException.trade_id == trade_id)

    stmt = (
        select(TradeException, Trade.instrument, ClientAccount.name)
        .join(Trade, Trade.id == TradeException.trade_id)
        .join(ClientAccount, ClientAccount.id == Trade.client_id, isouter=True)
        .where(and_(*conditions))
        .order_by(desc(TradeException.created_at), desc(TradeException.id))
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).all()
    return [_exc_to_response(exc, instr, cname) for exc, instr, cname in rows]


@router.post("/{exception_id}/resolve", response_model=TradeResponse)
async def resolve_exception(
    exception_id: int,
    body: ExceptionResolveRequest,
    db: AsyncSession = Depends(get_db),
) -> TradeResponse:
    exc: TradeException | None = await db.get(TradeException, exception_id)
    if exc is None:
        raise HTTPException(status_code=404, detail=f"Exception {exception_id} not found")
    if exc.status != ExceptionStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Exception {exception_id} already resolved",
        )

    trade = await resolve_exception_and_rerun(db, exc, resolution_note=body.resolution_note)
    client = await db.get(ClientAccount, trade.client_id)
    return _trade_to_response(trade, client.name if client else None)
