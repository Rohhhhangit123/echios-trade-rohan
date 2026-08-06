from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import ClientAccount, Position, ReferenceDatum, Trade, Side
from app.schemas import (
    ClientConcentration,
    FirmRiskResponse,
    HoldingConcentration,
    InstrumentExposure,
    PortfolioRiskResponse,
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


@router.get("/risk/firm", response_model=FirmRiskResponse)
async def get_firm_risk(db: AsyncSession = Depends(get_db)) -> FirmRiskResponse:
    """Cross-client concentration & instrument exposure, real data only."""
    stmt = (
        select(Position, ReferenceDatum, ClientAccount.name)
        .join(ReferenceDatum, ReferenceDatum.instrument == Position.instrument, isouter=True)
        .join(ClientAccount, ClientAccount.id == Position.client_id)
    )
    rows = (await db.execute(stmt)).all()

    client_mv: dict[int, Decimal] = {}
    client_names: dict[int, str] = {}
    client_pos_count: dict[int, int] = {}
    instrument_mv: dict[str, Decimal] = {}
    instrument_qty: dict[str, Decimal] = {}
    instrument_clients: dict[str, set[int]] = {}
    instrument_ref: dict[str, ReferenceDatum | None] = {}
    currency_exposure: dict[str, Decimal] = {}

    total_mv = Decimal("0")
    total_pnl = Decimal("0")

    for pos, ref, client_name in rows:
        current_price = await _current_price(db, pos.instrument, pos.avg_price)
        market_value = pos.quantity * current_price
        cost_basis = pos.quantity * pos.avg_price
        if market_value <= 0:
            continue
        total_mv += market_value
        total_pnl += market_value - cost_basis

        client_mv[pos.client_id] = client_mv.get(pos.client_id, Decimal("0")) + market_value
        client_names[pos.client_id] = client_name
        client_pos_count[pos.client_id] = client_pos_count.get(pos.client_id, 0) + 1

        instrument_mv[pos.instrument] = instrument_mv.get(pos.instrument, Decimal("0")) + market_value
        instrument_qty[pos.instrument] = instrument_qty.get(pos.instrument, Decimal("0")) + pos.quantity
        instrument_clients.setdefault(pos.instrument, set()).add(pos.client_id)
        instrument_ref[pos.instrument] = ref

        currency = ref.currency if ref else "USD"
        currency_exposure[currency] = currency_exposure.get(currency, Decimal("0")) + market_value

    client_concentration = [
        ClientConcentration(
            client_id=cid,
            client_name=client_names.get(cid),
            market_value=mv,
            weight_pct=round((mv / total_mv * Decimal("100")) if total_mv else Decimal("0"), 2),
            position_count=client_pos_count.get(cid, 0),
        )
        for cid, mv in sorted(client_mv.items(), key=lambda kv: kv[1], reverse=True)
    ]

    hhi = sum(float(c.weight_pct) ** 2 for c in client_concentration)

    instrument_exposure = [
        InstrumentExposure(
            instrument=inst,
            entity=(instrument_ref[inst].entity if instrument_ref.get(inst) else None),
            currency=(instrument_ref[inst].currency if instrument_ref.get(inst) else None),
            net_quantity=instrument_qty[inst],
            market_value=mv,
            weight_pct=round((mv / total_mv * Decimal("100")) if total_mv else Decimal("0"), 2),
            client_count=len(instrument_clients.get(inst, set())),
        )
        for inst, mv in sorted(instrument_mv.items(), key=lambda kv: kv[1], reverse=True)
    ]

    return FirmRiskResponse(
        total_market_value=total_mv,
        total_unrealized_pnl=total_pnl,
        client_count=len(client_mv),
        instrument_count=len(instrument_mv),
        client_concentration=client_concentration,
        herfindahl_index=round(hhi, 1),
        top_instrument_exposure=instrument_exposure[:10],
        currency_exposure=currency_exposure,
    )


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


@router.get("/{client_id}/risk", response_model=PortfolioRiskResponse)
async def get_portfolio_risk(client_id: int, db: AsyncSession = Depends(get_db)) -> PortfolioRiskResponse:
    """Concentration & exposure metrics derived purely from real positions/prices.

    No Beta/VaR/Sharpe/drawdown here — this system has no historical price
    series or benchmark feed, so those would be fabricated. Concentration and
    currency exposure are honest, position-based numbers.
    """
    client: ClientAccount | None = await db.get(ClientAccount, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail=f"Client {client_id} not found")

    stmt = (
        select(Position, ReferenceDatum)
        .join(ReferenceDatum, ReferenceDatum.instrument == Position.instrument, isouter=True)
        .where(Position.client_id == client_id)
    )
    rows = (await db.execute(stmt)).all()

    holdings: list[HoldingConcentration] = []
    total_mv = Decimal("0")
    total_pnl = Decimal("0")
    currency_exposure: dict[str, Decimal] = {}

    for pos, ref in rows:
        current_price = await _current_price(db, pos.instrument, pos.avg_price)
        market_value = pos.quantity * current_price
        cost_basis = pos.quantity * pos.avg_price
        unrealized = market_value - cost_basis
        if market_value <= 0:
            continue
        total_mv += market_value
        total_pnl += unrealized
        currency = ref.currency if ref else "USD"
        currency_exposure[currency] = currency_exposure.get(currency, Decimal("0")) + market_value
        holdings.append(
            HoldingConcentration(
                instrument=pos.instrument,
                market_value=market_value,
                weight_pct=Decimal("0"),
                unrealized_pnl=unrealized,
            )
        )

    holdings.sort(key=lambda h: h.market_value, reverse=True)

    hhi = 0.0
    for h in holdings:
        weight_pct = (h.market_value / total_mv * Decimal("100")) if total_mv else Decimal("0")
        h.weight_pct = weight_pct
        hhi += float(weight_pct) ** 2

    top1 = holdings[0].weight_pct if holdings else Decimal("0")
    top5 = sum((h.weight_pct for h in holdings[:5]), Decimal("0"))
    total_pnl_pct = (
        total_pnl / (total_mv - total_pnl) * Decimal("100") if (total_mv - total_pnl) != 0 else Decimal("0")
    )

    return PortfolioRiskResponse(
        client_id=client_id,
        client_name=client.name,
        total_market_value=total_mv,
        total_unrealized_pnl=total_pnl,
        total_unrealized_pnl_pct=total_pnl_pct,
        position_count=len(holdings),
        top_holdings=holdings[:10],
        herfindahl_index=round(hhi, 1),
        top1_weight_pct=round(top1, 2),
        top5_weight_pct=round(top5, 2),
        currency_exposure=currency_exposure,
    )
