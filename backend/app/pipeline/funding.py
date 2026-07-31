from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClientAccount, LedgerEntry, Position, Side, Trade, TradeStatus
from ._common import raise_exception


SECURITY_RATIO: dict[str, Decimal] = {}


async def _get_depot_balance(session: AsyncSession, client_id: int, instrument: str) -> Decimal:
    stmt = select(Position).where(
        Position.client_id == client_id, Position.instrument == instrument,
    )
    pos = (await session.execute(stmt)).scalars().first()
    return pos.quantity if pos else Decimal("0")


async def run_stage(trade: Trade, session: AsyncSession, simulated: bool = False) -> tuple[bool, str | None]:
    if simulated:
        trade.status = TradeStatus.FUNDED
        return True, "Paper-trade: skipped real nostro/depot balance checks"

    client: ClientAccount = await session.get_one(ClientAccount, trade.client_id)
    cash_needed = trade.filled_quantity * trade.price

    ratio = SECURITY_RATIO.get(trade.currency, Decimal("1.0"))
    cash_needed_ccy = cash_needed * ratio

    if trade.side == Side.BUY:
        if client.nostro_balance < cash_needed_ccy:
            await raise_exception(
                session, trade, TradeStatus.FUNDED,
                reason=(
                    f"Insufficient nostro ({client.nostro_balance:,.2f} {trade.currency}) "
                    f"to fund purchase of {cash_needed_ccy:,.2f} {trade.currency}"
                ),
                breaking_field="quantity",
            )
            return False, None
        client.nostro_balance -= cash_needed_ccy
        session.add(LedgerEntry(
            trade_id=trade.id, client_id=trade.client_id, entry_type="FUNDING_BUY",
            cash_delta=-cash_needed_ccy, security=trade.instrument,
            security_delta=trade.filled_quantity, currency=trade.currency,
        ))

    elif trade.side == Side.SELL:
        depot = await _get_depot_balance(session, trade.client_id, trade.instrument)
        if depot < trade.filled_quantity:
            await raise_exception(
                session, trade, TradeStatus.FUNDED,
                reason=(
                    f"Insufficient depot balance ({depot}) of {trade.instrument} "
                    f"to deliver sale qty {trade.filled_quantity}"
                ),
                breaking_field="quantity",
            )
            return False, None
        client.nostro_balance += cash_needed_ccy
        session.add(LedgerEntry(
            trade_id=trade.id, client_id=trade.client_id, entry_type="FUNDING_SELL",
            cash_delta=cash_needed_ccy, security=trade.instrument,
            security_delta=-trade.filled_quantity, currency=trade.currency,
        ))

    trade.status = TradeStatus.FUNDED
    return True, f"Nostro/depot balances reserved ({cash_needed_ccy:,.2f} {trade.currency})"
