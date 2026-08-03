from __future__ import annotations

from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import (
    ClientAccount,
    ExceptionStatus,
    Trade,
    TradeException,
    TradeHistory,
    TradeStatus,
)
from app.pipeline import run_pipeline
from app.schemas import (
    TradeCreateRequest,
    TradeHistoryEntryResponse,
    TradeListResponse,
    TradeResponse,
)

router = APIRouter(prefix="/trades", tags=["trades"])


async def _fetch_history(db: AsyncSession, trade_id: int) -> list[TradeHistoryEntryResponse]:
    rows = (await db.execute(
        select(TradeHistory)
        .where(TradeHistory.trade_id == trade_id)
        .order_by(TradeHistory.created_at, TradeHistory.id)
    )).scalars().all()
    return [TradeHistoryEntryResponse.model_validate(r) for r in rows]


async def _count_open_exceptions(db: AsyncSession, trade_id: int) -> int:
    stmt = (
        select(func.count(TradeException.id))
        .where(
            TradeException.trade_id == trade_id,
            TradeException.status == ExceptionStatus.OPEN,
        )
    )
    return (await db.execute(stmt)).scalar_one() or 0


def _trade_fields_to_resp(
    trade: Trade,
    *,
    history: list[TradeHistoryEntryResponse],
    exception_count: int,
    client_name: Optional[str] = None,
) -> TradeResponse:
    notional = (trade.filled_quantity or trade.quantity) * trade.price
    resp = TradeResponse(
        id=trade.id,
        client_id=trade.client_id,
        client_name=client_name,
        instrument=trade.instrument,
        side=trade.side.value if hasattr(trade.side, "value") else trade.side,
        quantity=trade.quantity,
        filled_quantity=trade.filled_quantity,
        price=trade.price,
        currency=trade.currency,
        status=trade.status.value if hasattr(trade.status, "value") else trade.status,
        last_successful_stage=(
            trade.last_successful_stage.value
            if (trade.last_successful_stage and hasattr(trade.last_successful_stage, "value"))
            else trade.last_successful_stage
        ),
        parent_trade_id=trade.parent_trade_id,
        simulated=trade.simulated,
        counterparty_id=trade.counterparty_id,
        settlement_mode=(
            trade.settlement_mode.value
            if hasattr(trade.settlement_mode, "value")
            else trade.settlement_mode
        ),
        settlement_failed=trade.settlement_failed,
        isin=trade.isin,
        entity=trade.entity,
        notional=notional,
        created_at=trade.created_at,
        updated_at=trade.updated_at,
        history=history,
        exception_count=exception_count,
    )
    return resp


@router.post("", response_model=TradeResponse, status_code=status.HTTP_201_CREATED)
async def create_trade(
    body: TradeCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> TradeResponse:
    client: ClientAccount | None = await db.get(ClientAccount, body.client_id)
    if client is None:
        raise HTTPException(status_code=404, detail=f"Client {body.client_id} not found")

    trade = Trade(
        client_id=body.client_id,
        instrument=body.instrument,
        side=body.side,
        quantity=body.quantity,
        price=body.price,
        currency=body.currency,
        status=TradeStatus.ONBOARDED,
        simulated=False,
        counterparty_id=body.counterparty_id,
        settlement_mode=body.settlement_mode,
    )
    db.add(trade)
    await db.flush()
    trade = await run_pipeline(trade, db, simulated=False)
    history = await _fetch_history(db, trade.id)
    exc_count = await _count_open_exceptions(db, trade.id)
    return _trade_fields_to_resp(trade, history=history, exception_count=exc_count, client_name=client.name)


@router.get("/{trade_id}", response_model=TradeResponse)
async def get_trade(trade_id: int, db: AsyncSession = Depends(get_db)) -> TradeResponse:
    stmt = (
        select(Trade, ClientAccount.name)
        .join(ClientAccount, ClientAccount.id == Trade.client_id, isouter=True)
        .where(Trade.id == trade_id)
    )
    result = await db.execute(stmt)
    row = result.first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")
    trade, client_name = row
    history = await _fetch_history(db, trade.id)
    exc_count = await _count_open_exceptions(db, trade.id)
    return _trade_fields_to_resp(trade, history=history, exception_count=exc_count, client_name=client_name)


@router.get("", response_model=TradeListResponse)
async def list_trades(
    client_id: Optional[int] = Query(default=None, gt=0),
    status: Optional[TradeStatus] = Query(default=None),
    instrument: Optional[str] = Query(default=None, min_length=1),
    simulated: Optional[bool] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> TradeListResponse:
    conditions = []
    if client_id is not None:
        conditions.append(Trade.client_id == client_id)
    if status is not None:
        conditions.append(Trade.status == status)
    if instrument is not None:
        conditions.append(Trade.instrument.ilike(f"%{instrument}%"))
    if simulated is not None:
        conditions.append(Trade.simulated == simulated)

    where = and_(*conditions) if conditions else True

    total_stmt = select(func.count(Trade.id)).where(where)
    total = (await db.execute(total_stmt)).scalar_one() or 0

    stmt = (
        select(Trade, ClientAccount.name)
        .join(ClientAccount, ClientAccount.id == Trade.client_id, isouter=True)
        .where(where)
        .order_by(desc(Trade.created_at), desc(Trade.id))
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).all()
    items = []
    for trade, name in rows:
        history = await _fetch_history(db, trade.id)
        exc_count = await _count_open_exceptions(db, trade.id)
        items.append(_trade_fields_to_resp(trade, history=history, exception_count=exc_count, client_name=name))
    return TradeListResponse(items=items, total=total)
    