from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import ClientAccount, Trade, TradeException, TradeStatus
from app.schemas import (
    ControlTowerResponse,
    StageFailureCount,
    ClientFailureCount,
    LiveTradeSummary,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


async def compute_control_tower(db: AsyncSession) -> ControlTowerResponse:
    total_trades = (await db.execute(select(func.count(Trade.id)))).scalar_one() or 0
    done_trades = (
        await db.execute(select(func.count(Trade.id)).where(Trade.status == TradeStatus.DONE))
    ).scalar_one() or 0
    open_exceptions = (
        await db.execute(select(func.count(TradeException.id)).where(TradeException.status == "OPEN"))
    ).scalar_one() or 0
    exception_trades = (
        await db.execute(select(func.count(Trade.id)).where(Trade.status == TradeStatus.EXCEPTION))
    ).scalar_one() or 0

    stp_rate = (done_trades / total_trades * 100) if total_trades else 0.0
    exception_rate = (exception_trades / total_trades * 100) if total_trades else 0.0

    # Average resolution time, in minutes, over resolved exceptions.
    resolved_stmt = select(TradeException.created_at, TradeException.resolved_at).where(
        TradeException.status == "RESOLVED", TradeException.resolved_at.is_not(None)
    )
    resolved_rows = (await db.execute(resolved_stmt)).all()
    if resolved_rows:
        total_seconds = sum(
            (r.resolved_at - r.created_at).total_seconds() for r in resolved_rows
        )
        avg_resolution_minutes = (total_seconds / len(resolved_rows)) / 60.0
    else:
        avg_resolution_minutes = 0.0

    # Stage with most (open) failures.
    stage_stmt = (
        select(TradeException.stage, func.count(TradeException.id).label("cnt"))
        .where(TradeException.status == "OPEN")
        .group_by(TradeException.stage)
        .order_by(func.count(TradeException.id).desc())
    )
    stage_rows = (await db.execute(stage_stmt)).all()
    top_failing_stages = [
        StageFailureCount(stage=row.stage, count=row.cnt) for row in stage_rows
    ]

    # Client-wise open exception count.
    client_stmt = (
        select(
            Trade.client_id,
            ClientAccount.name,
            func.count(TradeException.id).label("cnt"),
        )
        .join(TradeException, TradeException.trade_id == Trade.id)
        .join(ClientAccount, ClientAccount.id == Trade.client_id, isouter=True)
        .where(TradeException.status == "OPEN")
        .group_by(Trade.client_id, ClientAccount.name)
        .order_by(func.count(TradeException.id).desc())
        .limit(5)
    )
    client_rows = (await db.execute(client_stmt)).all()
    top_failing_clients = [
        ClientFailureCount(client_id=row.client_id, client_name=row.name, count=row.cnt)
        for row in client_rows
    ]

    # Day-over-day comparison: exceptions raised today vs yesterday (UTC calendar day).
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)

    today_count = (
        await db.execute(
            select(func.count(TradeException.id)).where(TradeException.created_at >= today_start)
        )
    ).scalar_one() or 0
    yesterday_count = (
        await db.execute(
            select(func.count(TradeException.id)).where(
                TradeException.created_at >= yesterday_start,
                TradeException.created_at < today_start,
            )
        )
    ).scalar_one() or 0

    return ControlTowerResponse(
        total_trades=total_trades,
        done_trades=done_trades,
        stp_rate=round(stp_rate, 2),
        open_exceptions=open_exceptions,
        exception_rate=round(exception_rate, 2),
        avg_resolution_minutes=round(avg_resolution_minutes, 1),
        top_failing_stages=top_failing_stages,
        top_failing_clients=top_failing_clients,
        exceptions_today=today_count,
        exceptions_yesterday=yesterday_count,
    )


@router.get("/control-tower", response_model=ControlTowerResponse)
async def control_tower(db: AsyncSession = Depends(get_db)) -> ControlTowerResponse:
    return await compute_control_tower(db)


@router.get("/live-trades", response_model=list[LiveTradeSummary])
async def live_trades(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
) -> list[LiveTradeSummary]:
    """Trades currently in-flight or in exception, for the Digital Twin live grid."""
    stmt = (
        select(Trade, ClientAccount.name)
        .join(ClientAccount, ClientAccount.id == Trade.client_id, isouter=True)
        .where(Trade.status != TradeStatus.DONE)
        .order_by(
            case((Trade.status == TradeStatus.EXCEPTION, 0), else_=1),
            Trade.updated_at.desc(),
        )
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()

    results: list[LiveTradeSummary] = []
    for trade, client_name in rows:
        exception_stage = None
        if trade.status == TradeStatus.EXCEPTION:
            exc_stmt = (
                select(TradeException.stage)
                .where(TradeException.trade_id == trade.id, TradeException.status == "OPEN")
                .order_by(TradeException.created_at.desc())
                .limit(1)
            )
            exception_stage = (await db.execute(exc_stmt)).scalar_one_or_none()
        results.append(
            LiveTradeSummary(
                id=trade.id,
                client_name=client_name,
                instrument=trade.instrument,
                status=trade.status,
                last_successful_stage=trade.last_successful_stage,
                exception_stage=exception_stage,
                updated_at=trade.updated_at,
            )
        )
    return results
