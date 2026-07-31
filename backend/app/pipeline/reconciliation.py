from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LedgerEntry, Trade, TradeStatus
from ._common import raise_exception


async def run_stage(trade: Trade, session: AsyncSession, simulated: bool = False) -> tuple[bool, str | None]:
    stmt = select(LedgerEntry).where(
        and_(
            LedgerEntry.trade_id == trade.id,
            LedgerEntry.entry_type.in_(["SETTLE_DVP", "SETTLE_FOP", "BANK_DVP", "BANK_FOP"]),
        )
    )
    entries = (await session.execute(stmt)).scalars().all()

    internal: dict[str, list[Decimal]] = defaultdict(lambda: [Decimal("0"), Decimal("0")])
    bank: dict[str, list[Decimal]] = defaultdict(lambda: [Decimal("0"), Decimal("0")])

    for e in entries:
        key = f"{e.currency}|{e.security or 'CASH'}"
        bucket = bank if e.is_bank else internal
        bucket[key][0] += e.cash_delta
        bucket[key][1] += e.security_delta

    all_keys = set(internal.keys()) | set(bank.keys())
    mismatches: list[str] = []
    for k in sorted(all_keys):
        i_cash, i_sec = internal[k]
        b_cash, b_sec = bank[k]
        if abs(i_cash - (-b_cash)) > Decimal("0.01"):
            mismatches.append(f"cash@{k}: internal={i_cash} bank={-b_cash} diff={i_cash + b_cash}")
        if abs(i_sec - (-b_sec)) > Decimal("0.0001"):
            mismatches.append(f"sec@{k}: internal={i_sec} bank={-b_sec} diff={i_sec + b_sec}")

    if mismatches:
        await raise_exception(
            session, trade, TradeStatus.RECONCILED,
            reason="Internal ledger vs bank statement mismatch: " + "; ".join(mismatches),
            breaking_field="settlement_mode",
        )
        return False, None

    trade.status = TradeStatus.RECONCILED
    return True, f"Reconciled OK ({len(entries)} ledger entries matched)"
