from __future__ import annotations

from decimal import Decimal

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClientAccount, Side, Trade, TradeStatus
from ._common import raise_exception


async def run_stage(trade: Trade, session: AsyncSession, simulated: bool = False) -> tuple[bool, str | None]:
    if trade.counterparty_id is None:
        trade.status = TradeStatus.CONFIRMED
        return True, "No counterparty specified; skipping bilateral confirmation"

    cp: ClientAccount | None = await session.get(ClientAccount, trade.counterparty_id)
    if cp is None:
        await raise_exception(
            session, trade, TradeStatus.CONFIRMED,
            reason=f"Counterparty client #{trade.counterparty_id} does not exist",
            breaking_field="counterparty_id",
        )
        return False, None

    opposite_side = Side.SELL if trade.side == Side.BUY else Side.BUY

    mirror_stmt = select(Trade).where(
        and_(
            Trade.client_id == trade.counterparty_id,
            Trade.counterparty_id == trade.client_id,
            Trade.side == opposite_side,
            Trade.instrument == trade.instrument,
            Trade.parent_trade_id == trade.parent_trade_id,
            Trade.id != trade.id,
        )
    )
    mirrors = (await session.execute(mirror_stmt)).scalars().all()

    if not mirrors:
        await raise_exception(
            session, trade, TradeStatus.CONFIRMED,
            reason=f"No matching mirror trade found for counterparty {cp.name}",
            breaking_field="counterparty_id",
        )
        return False, None

    mirror = mirrors[0]
    checks: list[tuple[str, Decimal | str | None, Decimal | str | None]] = [
        ("instrument", trade.instrument, mirror.instrument),
        ("quantity", trade.filled_quantity, mirror.filled_quantity),
        ("price", trade.price, mirror.price),
        ("currency", trade.currency, mirror.currency),
    ]
    for field, ours, theirs in checks:
        if field in {"quantity", "price"}:
            diff = abs((ours or 0) - (theirs or 0)) if isinstance(ours, (int, float, Decimal)) else 1
            if diff > Decimal("0.0001"):
                await raise_exception(
                    session, trade, TradeStatus.CONFIRMED,
                    reason=(
                        f"Counterparty mismatch on {field}: ours={ours} vs "
                        f"{cp.name}={theirs}"
                    ),
                    breaking_field=field,
                )
                return False, None
        else:
            if ours != theirs:
                await raise_exception(
                    session, trade, TradeStatus.CONFIRMED,
                    reason=(
                        f"Counterparty mismatch on {field}: ours={ours} vs "
                        f"{cp.name}={theirs}"
                    ),
                    breaking_field=field,
                )
                return False, None

    trade.status = TradeStatus.CONFIRMED
    return True, f"Bilateral match confirmed with {cp.name}"
