from __future__ import annotations

from datetime import datetime
from typing import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    STAGE_ORDER,
    ExceptionStatus,
    Trade,
    TradeException,
    TradeHistory,
    TradeStatus,
)

from ._common import broadcast, raise_exception, set_broadcast_hook, write_history

from .onboarding import run_stage as run_onboarding
from .execution import run_stage as run_execution
from .capture import run_stage as run_capture
from .enrichment import run_stage as run_enrichment
from .allocation import run_stage as run_allocation
from .validation import run_stage as run_validation
from .confirmation import run_stage as run_confirmation
from .funding import run_stage as run_funding
from .settlement import run_stage as run_settlement
from .reconciliation import run_stage as run_reconciliation

__all__ = [
    "raise_exception",
    "set_broadcast_hook",
    "run_pipeline",
    "resolve_exception_and_rerun",
]

StageFn = Callable[[Trade, AsyncSession, bool], tuple[bool, str | None]]

STAGE_FN_MAP: dict[TradeStatus, StageFn] = {
    TradeStatus.ONBOARDED: run_onboarding,
    TradeStatus.EXECUTED: run_execution,
    TradeStatus.CAPTURED: run_capture,
    TradeStatus.ENRICHED: run_enrichment,
    TradeStatus.ALLOCATED: run_allocation,
    TradeStatus.VALIDATED: run_validation,
    TradeStatus.CONFIRMED: run_confirmation,
    TradeStatus.FUNDED: run_funding,
    TradeStatus.SETTLED: run_settlement,
    TradeStatus.RECONCILED: run_reconciliation,
}


def _next_stage(current: TradeStatus) -> TradeStatus | None:
    try:
        idx = STAGE_ORDER.index(current)
    except ValueError:
        return None
    if idx + 1 < len(STAGE_ORDER):
        return STAGE_ORDER[idx + 1]
    return None


async def run_pipeline(
    trade: Trade,
    session: AsyncSession,
    *,
    start_stage: TradeStatus | None = None,
    simulated: bool = False,
) -> Trade:
    entry_status = start_stage or trade.status

    if entry_status == TradeStatus.DONE:
        return trade

    if entry_status == TradeStatus.EXCEPTION:
        if trade.last_successful_stage:
            start = trade.last_successful_stage
        else:
            start = STAGE_ORDER[0]
    else:
        if entry_status in STAGE_ORDER:
            start = entry_status
        else:
            start = STAGE_ORDER[0]

    start_idx = STAGE_ORDER.index(start)
    current_stage: TradeStatus | None = start

    for idx in range(start_idx, len(STAGE_ORDER)):
        stage_status = STAGE_ORDER[idx]

        if stage_status != trade.status and trade.status != TradeStatus.EXCEPTION:
            prev_status = trade.status
            trade.status = stage_status
            await write_history(session, trade, prev_status, stage_status)
            await session.flush()
            broadcast({"type": "trade_updated", "trade_id": trade.id, "status": stage_status.value})

        if stage_status == TradeStatus.DONE:
            trade.last_successful_stage = TradeStatus.RECONCILED
            break

        fn = STAGE_FN_MAP.get(stage_status)
        if fn is None:
            trade.last_successful_stage = stage_status
            current_stage = _next_stage(stage_status)
            continue

        ok, note = await fn(trade, session, simulated)
        await session.flush()
        if not ok:
            break

        trade.last_successful_stage = stage_status
        current_stage = _next_stage(stage_status)

    if trade.status != TradeStatus.EXCEPTION:
        if trade.last_successful_stage == TradeStatus.RECONCILED:
            prev = trade.status
            trade.status = TradeStatus.DONE
            await write_history(session, trade, prev, TradeStatus.DONE, note="Pipeline complete")
            broadcast({"type": "trade_updated", "trade_id": trade.id, "status": TradeStatus.DONE.value})

    await session.commit()
    await session.refresh(trade)
    return trade


async def resolve_exception_and_rerun(
    session: AsyncSession,
    exception: TradeException,
    resolution_note: str | None = None,
) -> Trade:
    exception.status = ExceptionStatus.RESOLVED
    exception.resolved_at = datetime.utcnow()
    exception.resolution_note = resolution_note
    trade: Trade = await session.get_one(Trade, exception.trade_id)
    prev_status = trade.status
    failed_stage = exception.stage
    failed_idx = STAGE_ORDER.index(failed_stage)
    restart_status = STAGE_ORDER[failed_idx]
    trade.status = restart_status
    await write_history(
        session, trade, prev_status, restart_status,
        note=f"Exception #{exception.id} resolved: {resolution_note or 'n/a'}",
    )
    await session.flush()
    broadcast({
        "type": "exception_resolved",
        "exception_id": exception.id,
        "trade_id": trade.id,
    })
    rerun_from = STAGE_ORDER[failed_idx]
    return await run_pipeline(trade, session, start_stage=rerun_from)
