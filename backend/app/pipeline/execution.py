from __future__ import annotations

from decimal import Decimal
import random

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Trade, TradeStatus
from ._common import raise_exception

random.seed(42)


async def run_stage(trade: Trade, session: AsyncSession, simulated: bool = False) -> tuple[bool, str | None]:
    if trade.quantity <= 0:
        await raise_exception(
            session, trade, TradeStatus.EXECUTED,
            reason="Quantity must be positive",
            breaking_field="quantity",
        )
        return False, None

    if trade.price <= 0:
        await raise_exception(
            session, trade, TradeStatus.EXECUTED,
            reason="Price must be positive",
            breaking_field="price",
        )
        return False, None

    fill_ratio = Decimal(random.choice(["1.0", "1.0", "1.0", "0.85", "1.0"]))
    filled = (trade.quantity * fill_ratio).quantize(Decimal("0.0001"))

    if trade.parent_trade_id is not None:
        filled = trade.quantity

    if filled <= 0:
        await raise_exception(
            session, trade, TradeStatus.EXECUTED,
            reason="No fills received for order",
            breaking_field="filled_quantity",
        )
        return False, None

    trade.filled_quantity = filled
    note = f"Filled {filled}/{trade.quantity} @ {trade.price} ({fill_ratio*100:.0f}%)"

    if fill_ratio < Decimal("1"):
        note += " PARTIAL FILL"

    trade.status = TradeStatus.EXECUTED
    return True, note
