from __future__ import annotations

from datetime import datetime
from typing import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ExceptionStatus,
    Trade,
    TradeException,
    TradeHistory,
    TradeStatus,
)

BroadcastFn = Callable[[dict], None]
_broadcast_hook: BroadcastFn | None = None


def set_broadcast_hook(fn: BroadcastFn | None) -> None:
    global _broadcast_hook
    _broadcast_hook = fn


def broadcast(payload: dict) -> None:
    if _broadcast_hook:
        try:
            _broadcast_hook(payload)
        except Exception:
            pass


async def write_history(
    session: AsyncSession,
    trade: Trade,
    from_status: TradeStatus | None,
    to_status: TradeStatus,
    note: str | None = None,
) -> None:
    h = TradeHistory(
        trade_id=trade.id,
        from_status=from_status,
        to_status=to_status,
        note=note,
    )
    session.add(h)


async def raise_exception(
    session: AsyncSession,
    trade: Trade,
    stage: TradeStatus,
    reason: str,
    breaking_field: str | None = None,
) -> None:
    prev_status = trade.status
    exc = TradeException(
        trade_id=trade.id,
        stage=stage,
        reason=reason,
        breaking_field=breaking_field,
        status=ExceptionStatus.OPEN,
    )
    session.add(exc)
    trade.status = TradeStatus.EXCEPTION
    await write_history(session, trade, prev_status, TradeStatus.EXCEPTION, note=f"{stage.value}: {reason}")
    await session.flush()
    broadcast({
        "type": "exception_created",
        "exception_id": exc.id,
        "trade_id": trade.id,
        "stage": stage.value,
        "reason": reason,
        "breaking_field": breaking_field,
    })
    broadcast({
        "type": "trade_updated",
        "trade_id": trade.id,
        "status": TradeStatus.EXCEPTION.value,
    })
