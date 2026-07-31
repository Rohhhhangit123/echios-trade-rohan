from __future__ import annotations

from decimal import Decimal

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Trade, TradeStatus
from ._common import raise_exception


async def run_stage(trade: Trade, session: AsyncSession, simulated: bool = False) -> tuple[bool, str | None]:
    required: list[tuple[str, object]] = [
        ("instrument", trade.instrument),
        ("side", trade.side),
        ("quantity", trade.quantity),
        ("price", trade.price),
        ("currency", trade.currency),
    ]
    for field_name, value in required:
        if value is None:
            await raise_exception(
                session, trade, TradeStatus.CAPTURED,
                reason=f"Missing required field: {field_name}",
                breaking_field=field_name,
            )
            return False, None

    if trade.quantity <= 0:
        await raise_exception(session, trade, TradeStatus.CAPTURED, "quantity must be > 0", "quantity")
        return False, None
    if trade.price <= 0:
        await raise_exception(session, trade, TradeStatus.CAPTURED, "price must be > 0", "price")
        return False, None
    if trade.currency not in {"USD", "EUR", "GBP", "JPY", "INR", "CAD", "AUD", "CHF"}:
        await raise_exception(
            session, trade, TradeStatus.CAPTURED,
            reason=f"Unsupported currency {trade.currency}", breaking_field="currency",
        )
        return False, None

    stmt = (
        select(func.count())
        .select_from(Trade)
        .where(
            Trade.id != trade.id,
            Trade.client_id == trade.client_id,
            Trade.instrument == trade.instrument,
            Trade.side == trade.side,
            Trade.quantity == trade.quantity,
            Trade.price == trade.price,
            Trade.simulated == trade.simulated,
            or_(
                and_(
                    trade.parent_trade_id.is_(None),
                    Trade.parent_trade_id.is_(None),
                ),
                Trade.parent_trade_id == trade.parent_trade_id,
            ),
            func.date_trunc("minute", Trade.created_at)
            >= func.date_trunc("minute", trade.created_at if trade.created_at else func.now())
            - func.make_interval(0, 0, 0, 0, 0, 1),
        )
    )
    result = await session.execute(stmt)
    dup_count = result.scalar_one() or 0
    if dup_count > 0:
        await raise_exception(
            session, trade, TradeStatus.CAPTURED,
            reason=f"Possible duplicate booking detected ({dup_count} matching trade in last 1 min)",
            breaking_field="instrument",
        )
        return False, None

    trade.status = TradeStatus.CAPTURED
    return True, "All required fields validated, no duplicates"
