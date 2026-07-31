from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import ClientAccount, Position, ReferenceDatum, Trade, Side
from app.schemas import (
    PortfolioSummary,
    PositionResponse,
)

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


async def _current_price(session: AsyncSession, instrument: str, fallback: Decimal) -> Decimal:
    stmt = (
        select(Trade.price)
        .where(Trade.instrument == instrument)
        .order_by(Trade.created_at.desc())
        .limit(1)
    )
    row = (await session.execute(stmt)).first()
    if row:
        return row[0]
    return fallback


@router.get("/{client_id}", response_model=PortfolioSummary)
async def get_portfolio(client_id: int, db: AsyncSession = Depends(get_db)) -> PortfolioSummary:
    client: ClientAccount | None = await db.get(ClientAccount, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail=f"Client {client_id} not found")

    stmt = (
        select(Position, ReferenceDatum)
        .join(ReferenceDatum, ReferenceDatum.instrument == Position.instrument, isouter=True)
        .where(Position.client_id == client_id)
    )
    rows = (await db.execute(stmt)).all()

    positions: list[PositionResponse] = []
    total_mv = Decimal("0")
    total_cb = Decimal("0")

    for pos, ref in rows:
        current_price = await _current_price(db, pos.instrument, pos.avg_price)
        qty = pos.quantity
        market_value = qty * current_price
        cost_basis = qty * pos.avg_price
        unrealized = market_value - cost_basis
        pnl_pct = (unrealized / cost_basis * Decimal("100")) if cost_basis != 0 else Decimal("0")

        pr = PositionResponse.model_validate(pos)
        pr.current_price = current_price
        pr.market_value = market_value
        pr.unrealized_pnl = unrealized
        pr.unrealized_pnl_pct = pnl_pct
        positions.append(pr)
        total_mv += market_value
        total_cb += cost_basis

    total_pnl = total_mv - total_cb
    total_pnl_pct = (total_pnl / total_cb * Decimal("100")) if total_cb != 0 else Decimal("0")

    return PortfolioSummary(
        client_id=client_id,
        client_name=client.name,
        positions=positions,
        total_market_value=total_mv,
        total_cost_basis=total_cb,
        total_unrealized_pnl=total_pnl,
        total_unrealized_pnl_pct=total_pnl_pct,
        nostro_balance=client.nostro_balance,
    )
