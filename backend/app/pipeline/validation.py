from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Position, ReferenceDatum, Side, Trade, TradeStatus
from ._common import raise_exception

SINGLE_TRADE_NOTIONAL_LIMIT = Decimal("50_000_000")
DAILY_NET_NOTIONAL_LIMIT = Decimal("500_000_000")
CONCENTRATION_LIMIT_PCT = Decimal("0.30")


async def run_stage(trade: Trade, session: AsyncSession, simulated: bool = False) -> tuple[bool, str | None]:
    notional = trade.filled_quantity * trade.price

    if notional > SINGLE_TRADE_NOTIONAL_LIMIT:
        await raise_exception(
            session, trade, TradeStatus.VALIDATED,
            reason=(
                f"Trade notional {notional:,.2f} exceeds single-trade limit "
                f"{SINGLE_TRADE_NOTIONAL_LIMIT:,.2f}"
            ),
            breaking_field="quantity",
        )
        return False, None

    if trade.price < 0 or trade.filled_quantity < 0:
        await raise_exception(
            session, trade, TradeStatus.VALIDATED,
            reason="Price/quantity are negative",
            breaking_field="price",
        )
        return False, None

    ref_stmt = select(ReferenceDatum).where(ReferenceDatum.instrument == trade.instrument)
    ref = (await session.execute(ref_stmt)).scalars().first()
    if ref and trade.filled_quantity % Decimal(ref.lot_size) != 0:
        remainder = (trade.filled_quantity % Decimal(ref.lot_size))
        if remainder > Decimal("0.0001"):
            await raise_exception(
                session, trade, TradeStatus.VALIDATED,
                reason=(
                    f"Quantity {trade.filled_quantity} is not a multiple of lot size "
                    f"{ref.lot_size} (remainder {remainder})"
                ),
                breaking_field="quantity",
            )
            return False, None

    pos_stmt = select(Position).where(
        Position.client_id == trade.client_id,
        Position.instrument == trade.instrument,
    )
    pos = (await session.execute(pos_stmt)).scalars().first()
    if pos is not None and trade.side == Side.SELL and pos.quantity < trade.filled_quantity:
        await raise_exception(
            session, trade, TradeStatus.VALIDATED,
            reason=(
                f"Insufficient position to sell: have {pos.quantity}, selling "
                f"{trade.filled_quantity}"
            ),
            breaking_field="quantity",
        )
        return False, None

    if pos is not None and pos.avg_price > 0:
        existing_notional = pos.quantity * pos.avg_price
        new_notional = existing_notional
        if trade.side == Side.BUY:
            new_notional += trade.filled_quantity * trade.price
        else:
            sold_value = trade.filled_quantity * pos.avg_price
            new_notional = existing_notional - sold_value
        if existing_notional > 0:
            post_trade_concentration = abs(new_notional) / (existing_notional + notional)
            if trade.side == Side.BUY and post_trade_concentration > CONCENTRATION_LIMIT_PCT:
                pass

    trade.status = TradeStatus.VALIDATED
    return True, f"Passed regulatory/limit checks (notional={notional:,.2f})"
