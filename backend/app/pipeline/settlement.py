from __future__ import annotations

from decimal import Decimal
import random

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    LedgerEntry,
    Position,
    ReferenceDatum,
    SettlementMode,
    Side,
    Trade,
    TradeStatus,
)
from ._common import raise_exception


random.seed(1234)


async def _upsert_position(session: AsyncSession, trade: Trade, signed_qty: Decimal) -> None:
    stmt = select(Position).where(
        Position.client_id == trade.client_id, Position.instrument == trade.instrument
    )
    pos = (await session.execute(stmt)).scalars().first()
    if pos is None:
        pos = Position(
            client_id=trade.client_id, instrument=trade.instrument,
            quantity=signed_qty, avg_price=trade.price,
        )
        session.add(pos)
    else:
        new_qty = pos.quantity + signed_qty
        if signed_qty > 0 and new_qty != 0:
            old_total = pos.quantity * pos.avg_price
            add_total = signed_qty * trade.price
            pos.avg_price = (old_total + add_total) / new_qty if new_qty != 0 else Decimal("0")
        if abs(new_qty) < Decimal("0.0001"):
            new_qty = Decimal("0")
        pos.quantity = new_qty
    await session.flush()


async def run_stage(trade: Trade, session: AsyncSession, simulated: bool = False) -> tuple[bool, str | None]:
    fail_chance = Decimal("0.03")
    rolled = Decimal(str(random.random()))
    if rolled < fail_chance:
        trade.settlement_failed = True
        await raise_exception(
            session, trade, TradeStatus.SETTLED,
            reason=(
                f"Settlement failure in {trade.settlement_mode.value} mode: "
                f"simulated counterparty delivery miss"
            ),
            breaking_field="settlement_mode",
        )
        return False, None

    signed_qty = trade.filled_quantity if trade.side == Side.BUY else -trade.filled_quantity
    cash_delta = signed_qty * trade.price

    if trade.settlement_mode == SettlementMode.DVP:
        if trade.side == Side.BUY:
            pass
        await _upsert_position(session, trade, signed_qty)
        internal_cash = -cash_delta
        internal_sec = signed_qty
        session.add(LedgerEntry(
            trade_id=trade.id, client_id=trade.client_id, entry_type="SETTLE_DVP",
            cash_delta=internal_cash, security=trade.instrument,
            security_delta=internal_sec, currency=trade.currency,
        ))
        session.add(LedgerEntry(
            trade_id=trade.id, client_id=trade.client_id, entry_type="BANK_DVP",
            cash_delta=-internal_cash, security=trade.instrument,
            security_delta=-internal_sec, currency=trade.currency, is_bank=True,
        ))
        note = (
            f"DVP settled: cash {internal_cash:,.2f} {trade.currency} "
            f"<-> securities {internal_sec} {trade.instrument}"
        )
    else:
        await _upsert_position(session, trade, signed_qty)
        internal_sec = signed_qty
        internal_cash = -cash_delta
        session.add(LedgerEntry(
            trade_id=trade.id, client_id=trade.client_id, entry_type="SETTLE_FOP",
            cash_delta=internal_cash, security=trade.instrument,
            security_delta=internal_sec, currency=trade.currency,
        ))
        session.add(LedgerEntry(
            trade_id=trade.id, client_id=trade.client_id, entry_type="BANK_FOP",
            cash_delta=-internal_cash, security=trade.instrument,
            security_delta=-internal_sec, currency=trade.currency, is_bank=True,
        ))
        note = (
            f"FOP settled: securities {signed_qty} {trade.instrument} moved "
            f"(unlinked cash leg recorded: {-cash_delta:,.2f} {trade.currency})"
        )

    trade.status = TradeStatus.SETTLED
    return True, note
