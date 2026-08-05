from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ClientAccount,
    ExceptionStatus,
    LedgerEntry,
    Position,
    Trade,
    TradeException,
    TradeHistory,
)
from app.services.assistant_citations import CitationRecord


def _decimal(value: Decimal | int | float | str) -> str:
    return format(Decimal(str(value)), "f")


@dataclass(frozen=True)
class AssistantUserData:
    client: dict[str, Any]
    positions: list[dict[str, Any]]
    trades: list[dict[str, Any]]
    open_exception_ids: list[int]
    open_exception_citation_id: str
    recent_exceptions: list[dict[str, Any]]
    ledger_entries: list[dict[str, Any]]
    trade_history: list[dict[str, Any]]
    citations: dict[str, CitationRecord]


class AssistantUserRepository(Protocol):
    async def load(
        self,
        *,
        client_id: int,
        include_history: bool,
    ) -> AssistantUserData: ...


class SqlAlchemyAssistantUserRepository:
    """Current Supabase adapter; the retrieval service depends only on the protocol above."""

    def __init__(self, session: AsyncSession, *, source_label: str) -> None:
        self.session = session
        self.source_label = source_label

    def _citation(
        self,
        *,
        table: str,
        record_id: int,
        description: str,
    ) -> CitationRecord:
        citation_id = f"db:{table}:{record_id}"
        return CitationRecord(
            id=citation_id,
            source_type="database",
            label=self.source_label,
            detail=f"{table} row id={record_id}; {description}",
            table=table,
            record_ids=[record_id],
        )

    async def load(
        self,
        *,
        client_id: int,
        include_history: bool,
    ) -> AssistantUserData:
        client = await self.session.get(ClientAccount, client_id)
        if client is None:
            raise LookupError(f"Client {client_id} not found")

        positions = (
            await self.session.execute(
                select(Position)
                .where(Position.client_id == client_id)
                .order_by(Position.instrument)
            )
        ).scalars().all()
        trades = (
            await self.session.execute(
                select(Trade)
                .where(Trade.client_id == client_id)
                .order_by(Trade.created_at.desc())
                .limit(50)
            )
        ).scalars().all()
        open_exception_ids = list(
            (
                await self.session.execute(
                    select(TradeException.id)
                    .join(Trade, Trade.id == TradeException.trade_id)
                    .where(
                        Trade.client_id == client_id,
                        TradeException.status == ExceptionStatus.OPEN,
                    )
                    .order_by(TradeException.id)
                )
            ).scalars()
        )
        recent_exceptions = (
            await self.session.execute(
                select(TradeException, Trade.instrument)
                .join(Trade, Trade.id == TradeException.trade_id)
                .where(Trade.client_id == client_id)
                .order_by(TradeException.created_at.desc())
                .limit(8)
            )
        ).all()
        ledger_entries = (
            await self.session.execute(
                select(LedgerEntry)
                .where(LedgerEntry.client_id == client_id)
                .order_by(LedgerEntry.id)
            )
        ).scalars().all()

        history: list[TradeHistory] = []
        if include_history:
            history = list(
                (
                    await self.session.execute(
                        select(TradeHistory)
                        .join(Trade, Trade.id == TradeHistory.trade_id)
                        .where(Trade.client_id == client_id)
                        .order_by(TradeHistory.created_at.desc())
                        .limit(30)
                    )
                ).scalars()
            )

        citations: dict[str, CitationRecord] = {}

        def register(citation: CitationRecord) -> str:
            citations[citation.id] = citation
            return citation.id

        client_citation = register(
            self._citation(
                table="client_accounts",
                record_id=client.id,
                description="account identity, KYC status, and nostro balance",
            )
        )
        client_row = {
            "id": client.id,
            "name": client.name,
            "kyc_status": client.kyc_status.value,
            "nostro_balance": _decimal(client.nostro_balance),
            "citation_ids": [client_citation],
        }

        open_exception_citation_id = f"db:exceptions:open-client:{client_id}"
        citations[open_exception_citation_id] = CitationRecord(
            id=open_exception_citation_id,
            source_type="database",
            label=self.source_label,
            detail=(
                f"exceptions rows ids={open_exception_ids}; client_id={client_id}, "
                f"status=OPEN, count={len(open_exception_ids)}"
            ),
            table="exceptions",
            record_ids=open_exception_ids,
        )

        position_rows = []
        for position in positions:
            citation_id = register(
                self._citation(
                    table="positions",
                    record_id=position.id,
                    description=f"client_id={client_id}, instrument={position.instrument}",
                )
            )
            position_rows.append(
                {
                    "position_id": position.id,
                    "client_id": position.client_id,
                    "instrument": position.instrument.upper(),
                    "quantity": _decimal(position.quantity),
                    "average_price": _decimal(position.avg_price),
                    "updated_at": position.updated_at.isoformat(),
                    "citation_ids": [citation_id],
                }
            )

        trade_rows = []
        for trade in trades:
            citation_id = register(
                self._citation(
                    table="trades",
                    record_id=trade.id,
                    description=f"client_id={client_id}, instrument={trade.instrument}",
                )
            )
            trade_rows.append(
                {
                    "trade_id": trade.id,
                    "instrument": trade.instrument.upper(),
                    "side": trade.side.value,
                    "quantity": _decimal(trade.quantity),
                    "filled_quantity": _decimal(trade.filled_quantity),
                    "trade_price": _decimal(trade.price),
                    "status": trade.status.value,
                    "simulated_trade": trade.simulated,
                    "created_at": trade.created_at.isoformat(),
                    "citation_ids": [citation_id],
                }
            )

        exception_rows = []
        for exception, instrument in recent_exceptions:
            citation_id = register(
                self._citation(
                    table="exceptions",
                    record_id=exception.id,
                    description=f"trade_id={exception.trade_id}, stage={exception.stage.value}",
                )
            )
            exception_rows.append(
                {
                    "exception_id": exception.id,
                    "trade_id": exception.trade_id,
                    "instrument": instrument,
                    "stage": exception.stage.value,
                    "reason": exception.reason,
                    "status": exception.status.value,
                    "created_at": exception.created_at.isoformat(),
                    "citation_ids": [citation_id],
                }
            )

        ledger_rows = []
        for entry in ledger_entries:
            citation_id = register(
                self._citation(
                    table="ledger_entries",
                    record_id=entry.id,
                    description=f"client_id={client_id}, entry_type={entry.entry_type}",
                )
            )
            ledger_rows.append(
                {
                    "ledger_entry_id": entry.id,
                    "trade_id": entry.trade_id,
                    "entry_type": entry.entry_type,
                    "cash_delta": _decimal(entry.cash_delta),
                    "security_delta": _decimal(entry.security_delta),
                    "security": entry.security,
                    "currency": entry.currency,
                    "is_bank": entry.is_bank,
                    "citation_ids": [citation_id],
                }
            )

        history_rows = []
        for row in history:
            citation_id = register(
                self._citation(
                    table="trade_history",
                    record_id=row.id,
                    description=f"trade_id={row.trade_id}, to_status={row.to_status.value}",
                )
            )
            history_rows.append(
                {
                    "history_id": row.id,
                    "trade_id": row.trade_id,
                    "from_status": row.from_status.value if row.from_status else None,
                    "to_status": row.to_status.value,
                    "note": row.note,
                    "created_at": row.created_at.isoformat(),
                    "citation_ids": [citation_id],
                }
            )

        return AssistantUserData(
            client=client_row,
            positions=position_rows,
            trades=trade_rows,
            open_exception_ids=open_exception_ids,
            open_exception_citation_id=open_exception_citation_id,
            recent_exceptions=exception_rows,
            ledger_entries=ledger_rows,
            trade_history=history_rows,
            citations=citations,
        )
