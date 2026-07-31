from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReferenceDatum, Trade, TradeStatus
from ._common import raise_exception


async def run_stage(trade: Trade, session: AsyncSession, simulated: bool = False) -> tuple[bool, str | None]:
    stmt = select(ReferenceDatum).where(ReferenceDatum.instrument == trade.instrument)
    result = await session.execute(stmt)
    ref: ReferenceDatum | None = result.scalars().first()

    if ref is None:
        await raise_exception(
            session, trade, TradeStatus.ENRICHED,
            reason=f"No reference data found for instrument '{trade.instrument}'",
            breaking_field="instrument",
        )
        return False, None

    if not ref.isin:
        await raise_exception(
            session, trade, TradeStatus.ENRICHED,
            reason=f"Reference data missing ISIN for {trade.instrument}",
            breaking_field="instrument",
        )
        return False, None
    if not ref.entity:
        await raise_exception(
            session, trade, TradeStatus.ENRICHED,
            reason=f"Reference data missing entity for {trade.instrument}",
            breaking_field="instrument",
        )
        return False, None

    trade.isin = ref.isin
    trade.entity = ref.entity
    if not trade.currency or trade.currency == "USD":
        trade.currency = ref.currency

    trade.status = TradeStatus.ENRICHED
    return True, f"Enriched: ISIN={ref.isin}, entity={ref.entity}, ccy={ref.currency}"
