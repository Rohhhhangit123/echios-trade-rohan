from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Allocation, Side, Trade, TradeStatus
from ._common import raise_exception


async def run_stage(trade: Trade, session: AsyncSession, simulated: bool = False) -> tuple[bool, str | None]:
    if trade.parent_trade_id is not None:
        trade.status = TradeStatus.ALLOCATED
        return True, "Child trade - skipping allocation split"

    stmt = (
        select(Allocation)
        .where(Allocation.parent_trade_id == trade.id)
    )
    result = await session.execute(stmt)
    existing = result.scalars().all()

    if not existing:
        trade.status = TradeStatus.ALLOCATED
        return True, "No allocation specified (single-leg trade) - OK"

    child_sum = Decimal("0")
    for alloc in existing:
        if alloc.quantity <= 0:
            await raise_exception(
                session, trade, TradeStatus.ALLOCATED,
                reason=f"Allocation #{alloc.id} has non-positive quantity",
                breaking_field="quantity",
            )
            return False, None
        child_sum += alloc.quantity

    if abs(child_sum - trade.filled_quantity) > Decimal("0.0001"):
        await raise_exception(
            session, trade, TradeStatus.ALLOCATED,
            reason=(
                f"Child allocations sum {child_sum} does not match parent filled qty "
                f"{trade.filled_quantity} (diff={abs(child_sum - trade.filled_quantity)})"
            ),
            breaking_field="quantity",
        )
        return False, None

    child_stmt = select(Trade).where(Trade.parent_trade_id == trade.id)
    children = (await session.execute(child_stmt)).scalars().all()
    for child in children:
        if child.client_id == trade.client_id and child.instrument == trade.instrument:
            continue
        if child.side != trade.side:
            await raise_exception(
                session, trade, TradeStatus.ALLOCATED,
                reason=f"Child trade #{child.id} side {child.side} != parent {trade.side}",
                breaking_field="side",
            )
            return False, None

    trade.status = TradeStatus.ALLOCATED
    return True, f"Allocated into {len(existing)} child legs (sum={child_sum})"
