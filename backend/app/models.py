from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class TradeStatus(str, enum.Enum):
    ONBOARDED = "ONBOARDED"
    EXECUTED = "EXECUTED"
    CAPTURED = "CAPTURED"
    ENRICHED = "ENRICHED"
    ALLOCATED = "ALLOCATED"
    VALIDATED = "VALIDATED"
    CONFIRMED = "CONFIRMED"
    FUNDED = "FUNDED"
    SETTLED = "SETTLED"
    RECONCILED = "RECONCILED"
    DONE = "DONE"
    EXCEPTION = "EXCEPTION"


STAGE_ORDER: list[TradeStatus] = [
    TradeStatus.ONBOARDED,
    TradeStatus.EXECUTED,
    TradeStatus.CAPTURED,
    TradeStatus.ENRICHED,
    TradeStatus.ALLOCATED,
    TradeStatus.VALIDATED,
    TradeStatus.CONFIRMED,
    TradeStatus.FUNDED,
    TradeStatus.SETTLED,
    TradeStatus.RECONCILED,
    TradeStatus.DONE,
]


class Side(str, enum.Enum):
    BUY = "BUY"
    SELL = "SELL"


class KycStatus(str, enum.Enum):
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    EXPIRED = "EXPIRED"
    REJECTED = "REJECTED"


class ExceptionStatus(str, enum.Enum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"


class SettlementMode(str, enum.Enum):
    DVP = "DVP"
    FOP = "FOP"


class ClientAccount(Base):
    __tablename__ = "client_accounts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kyc_status: Mapped[KycStatus] = mapped_column(Enum(KycStatus, name="kyc_status_enum"), nullable=False, default=KycStatus.PENDING)
    kyc_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    nostro_balance: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("10000000.0000"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    trades: Mapped[list["Trade"]] = relationship(
        "Trade", back_populates="client", foreign_keys="Trade.client_id", cascade="all, delete-orphan"
    )
    trades_as_counterparty: Mapped[list["Trade"]] = relationship(
        "Trade", back_populates="counterparty_client", foreign_keys="Trade.counterparty_id"
    )
    positions: Mapped[list["Position"]] = relationship("Position", back_populates="client", cascade="all, delete-orphan")


class ReferenceDatum(Base):
    __tablename__ = "reference_data"

    instrument: Mapped[str] = mapped_column(String(32), primary_key=True)
    isin: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    entity: Mapped[str] = mapped_column(String(255), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(6, 4), nullable=False, default=Decimal("0.0000"))
    lot_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    tick_size: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False, default=Decimal("0.01"))
    settlement_cycle_days: Mapped[int] = mapped_column(BigInteger, nullable=False, default=2)


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("client_accounts.id", ondelete="RESTRICT"), nullable=False, index=True)
    instrument: Mapped[str] = mapped_column(String(32), ForeignKey("reference_data.instrument", ondelete="RESTRICT"), nullable=False, index=True)
    side: Mapped[Side] = mapped_column(Enum(Side, name="side_enum"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    filled_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    price: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    status: Mapped[TradeStatus] = mapped_column(Enum(TradeStatus, name="trade_status_enum"), nullable=False, index=True, default=TradeStatus.ONBOARDED)
    last_successful_stage: Mapped[TradeStatus | None] = mapped_column(Enum(TradeStatus, name="trade_status_enum"), nullable=True)
    parent_trade_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("trades.id", ondelete="SET NULL"), nullable=True, index=True)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    counterparty_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("client_accounts.id", ondelete="SET NULL"), nullable=True)
    settlement_mode: Mapped[SettlementMode] = mapped_column(Enum(SettlementMode, name="settlement_mode_enum"), nullable=False, default=SettlementMode.DVP)
    settlement_failed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    isin: Mapped[str | None] = mapped_column(String(12), nullable=True)
    entity: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    client: Mapped["ClientAccount"] = relationship("ClientAccount", back_populates="trades", foreign_keys=[client_id])
    counterparty_client: Mapped["ClientAccount | None"] = relationship(
        "ClientAccount", back_populates="trades_as_counterparty", foreign_keys=[counterparty_id]
    )
    parent_trade: Mapped["Trade | None"] = relationship("Trade", remote_side=[id], foreign_keys=[parent_trade_id])
    allocations_as_parent: Mapped[list["Allocation"]] = relationship(
        "Allocation", back_populates="parent_trade", foreign_keys="Allocation.parent_trade_id"
    )
    allocations_as_child: Mapped[list["Allocation"]] = relationship(
        "Allocation", back_populates="child_trade", foreign_keys="Allocation.child_trade_id"
    )
    exceptions: Mapped[list["TradeException"]] = relationship(
        "TradeException", back_populates="trade", cascade="all, delete-orphan"
    )
    history: Mapped[list["TradeHistory"]] = relationship(
        "TradeHistory", back_populates="trade", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_trades_client_status_created", "client_id", "status", "created_at"),
        CheckConstraint("quantity > 0", name="ck_trade_qty_positive"),
        CheckConstraint("price > 0", name="ck_trade_price_positive"),
    )


class Allocation(Base):
    __tablename__ = "allocations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_trade_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("trades.id", ondelete="CASCADE"), nullable=False, index=True)
    child_trade_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("trades.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    parent_trade: Mapped["Trade"] = relationship("Trade", back_populates="allocations_as_parent", foreign_keys=[parent_trade_id])
    child_trade: Mapped["Trade"] = relationship("Trade", back_populates="allocations_as_child", foreign_keys=[child_trade_id])

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_alloc_qty_positive"),
    )


class TradeException(Base):
    __tablename__ = "exceptions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    trade_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("trades.id", ondelete="CASCADE"), nullable=False, index=True)
    stage: Mapped[TradeStatus] = mapped_column(Enum(TradeStatus, name="trade_status_enum"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    breaking_field: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[ExceptionStatus] = mapped_column(Enum(ExceptionStatus, name="exception_status_enum"), nullable=False, default=ExceptionStatus.OPEN, index=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    trade: Mapped["Trade"] = relationship("Trade", back_populates="exceptions")


class TradeHistory(Base):
    __tablename__ = "trade_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    trade_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("trades.id", ondelete="CASCADE"), nullable=False, index=True)
    from_status: Mapped[TradeStatus | None] = mapped_column(Enum(TradeStatus, name="trade_status_enum"), nullable=True)
    to_status: Mapped[TradeStatus] = mapped_column(Enum(TradeStatus, name="trade_status_enum"), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    trade: Mapped["Trade"] = relationship("Trade", back_populates="history")


class Position(Base):
    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("client_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    instrument: Mapped[str] = mapped_column(String(32), ForeignKey("reference_data.instrument", ondelete="RESTRICT"), nullable=False, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    avg_price: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False, default=Decimal("0"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    client: Mapped["ClientAccount"] = relationship("ClientAccount", back_populates="positions")

    __table_args__ = (
        UniqueConstraint("client_id", "instrument", name="uq_client_instrument_position"),
    )


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    trade_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("trades.id", ondelete="SET NULL"), nullable=True, index=True)
    client_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("client_accounts.id", ondelete="RESTRICT"), nullable=False, index=True)
    entry_type: Mapped[str] = mapped_column(String(32), nullable=False)
    cash_delta: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    security: Mapped[str | None] = mapped_column(String(32), nullable=True)
    security_delta: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    is_bank: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    TRADER = "TRADER"
    COMPLIANCE = "COMPLIANCE"
    VIEWER = "VIEWER"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role_enum"), nullable=False, default=UserRole.VIEWER, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
