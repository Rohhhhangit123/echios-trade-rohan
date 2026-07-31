from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import ClientAccount, Trade, TradeStatus
from app.pipeline import run_pipeline
from app.routers.trades import _trade_to_response
from app.schemas import TradeCreateRequest, TradeResponse

router = APIRouter(prefix="/paper-trading", tags=["paper-trading"])


@router.post("/trades", response_model=TradeResponse, status_code=status.HTTP_201_CREATED)
async def create_paper_trade(
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
        simulated=True,
        counterparty_id=body.counterparty_id,
        settlement_mode=body.settlement_mode,
    )
    db.add(trade)
    await db.flush()
    trade = await run_pipeline(trade, db, simulated=True)
    return _trade_to_response(trade, client.name)
