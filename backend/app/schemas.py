from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    ExceptionStatus,
    KycStatus,
    SettlementMode,
    Side,
    TradeStatus,
    UserRole,
)


class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


# ---------- Client accounts ----------

class ClientAccountResponse(_Base):
    id: int
    name: str
    kyc_status: KycStatus
    kyc_expiry: Optional[date]
    nostro_balance: Decimal
    created_at: datetime


# ---------- Trades ----------

class TradeCreateRequest(_Base):
    client_id: int = Field(..., gt=0)
    instrument: str = Field(..., min_length=1, max_length=32)
    side: Side
    quantity: Decimal = Field(..., gt=0, max_digits=18, decimal_places=4)
    price: Decimal = Field(..., gt=0, max_digits=18, decimal_places=6)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    counterparty_id: Optional[int] = Field(default=None, gt=0)
    settlement_mode: SettlementMode = Field(default=SettlementMode.DVP)


class TradeHistoryEntryResponse(_Base):
    id: int
    from_status: Optional[TradeStatus]
    to_status: TradeStatus
    note: Optional[str]
    created_at: datetime


class TradeResponse(_Base):
    id: int
    client_id: int
    client_name: Optional[str] = None
    instrument: str
    side: Side
    quantity: Decimal
    filled_quantity: Decimal
    price: Decimal
    currency: str
    status: TradeStatus
    last_successful_stage: Optional[TradeStatus]
    parent_trade_id: Optional[int]
    simulated: bool
    counterparty_id: Optional[int]
    settlement_mode: SettlementMode
    settlement_failed: bool
    isin: Optional[str]
    entity: Optional[str]
    notional: Decimal = Decimal("0")
    created_at: datetime
    updated_at: datetime
    history: list[TradeHistoryEntryResponse] = []
    exception_count: int = 0


class TradeListResponse(_Base):
    items: list[TradeResponse]
    total: int


# ---------- Allocations ----------

class AllocationCreateRequest(_Base):
    parent_trade_id: int
    child_trade_id: int
    quantity: Decimal = Field(..., gt=0)


# ---------- Exceptions ----------

class ExceptionResolveRequest(_Base):
    resolution_note: Optional[str] = Field(default=None, max_length=5000)


class ExceptionResponse(_Base):
    id: int
    trade_id: int
    stage: TradeStatus
    reason: str
    breaking_field: Optional[str]
    status: ExceptionStatus
    resolution_note: Optional[str]
    created_at: datetime
    resolved_at: Optional[datetime]
    trade_instrument: Optional[str] = None
    trade_client_name: Optional[str] = None


# ---------- Portfolio / Positions ----------

class PositionResponse(_Base):
    client_id: int
    instrument: str
    quantity: Decimal
    avg_price: Decimal
    current_price: Decimal = Decimal("0")
    market_value: Decimal = Decimal("0")
    unrealized_pnl: Decimal = Decimal("0")
    unrealized_pnl_pct: Decimal = Decimal("0")
    updated_at: datetime


class PortfolioSummary(_Base):
    client_id: int
    client_name: Optional[str] = None
    positions: list[PositionResponse]
    total_market_value: Decimal = Decimal("0")
    total_cost_basis: Decimal = Decimal("0")
    total_unrealized_pnl: Decimal = Decimal("0")
    total_unrealized_pnl_pct: Decimal = Decimal("0")
    nostro_balance: Decimal = Decimal("0")


# ---------- Portfolio risk (concentration / exposure, real-data only) ----------

class HoldingConcentration(_Base):
    instrument: str
    market_value: Decimal
    weight_pct: Decimal
    unrealized_pnl: Decimal


class ClientConcentration(_Base):
    client_id: int
    client_name: Optional[str] = None
    market_value: Decimal
    weight_pct: Decimal
    position_count: int


class InstrumentExposure(_Base):
    instrument: str
    entity: Optional[str] = None
    currency: Optional[str] = None
    net_quantity: Decimal
    market_value: Decimal
    weight_pct: Decimal
    client_count: int


class PortfolioRiskResponse(_Base):
    client_id: int
    client_name: Optional[str] = None
    total_market_value: Decimal = Decimal("0")
    total_unrealized_pnl: Decimal = Decimal("0")
    total_unrealized_pnl_pct: Decimal = Decimal("0")
    position_count: int = 0
    top_holdings: list[HoldingConcentration] = []
    herfindahl_index: float = 0.0
    top1_weight_pct: Decimal = Decimal("0")
    top5_weight_pct: Decimal = Decimal("0")
    currency_exposure: dict[str, Decimal] = {}


class FirmRiskResponse(_Base):
    total_market_value: Decimal = Decimal("0")
    total_unrealized_pnl: Decimal = Decimal("0")
    client_count: int = 0
    instrument_count: int = 0
    client_concentration: list[ClientConcentration] = []
    herfindahl_index: float = 0.0
    top_instrument_exposure: list[InstrumentExposure] = []
    currency_exposure: dict[str, Decimal] = {}


# ---------- GenAI ----------

class GenaiParseOrderRequest(_Base):
    prompt: str = Field(..., min_length=3, max_length=2000)
    default_client_id: Optional[int] = None


class ParsedOrder(_Base):
    instrument: Optional[str] = None
    side: Optional[Side] = None
    quantity: Optional[Decimal] = None
    price: Optional[Decimal] = None
    at_market: bool = False
    currency: str = "USD"
    confidence: float = 0.0
    notes: Optional[str] = None


class GenaiParseOrderResponse(_Base):
    parsed: ParsedOrder
    raw_summary: str


class GenaiExplainExceptionResponse(_Base):
    summary: str
    likely_root_cause: Optional[str] = None
    suggested_fix: Optional[str] = None
    raw: Optional[str] = None


class AssistantHistoryMessage(_Base):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class AssistantChatRequest(_Base):
    message: str = Field(..., min_length=2, max_length=2000)
    history: list[AssistantHistoryMessage] = Field(default_factory=list, max_length=8)


class AssistantClaim(_Base):
    text: str
    citation_ids: list[str] = Field(default_factory=list)


class AssistantCitation(_Base):
    id: str
    source_type: Literal["database", "csv", "json"]
    label: str
    detail: str
    table: Optional[str] = None
    record_ids: list[int] = Field(default_factory=list)
    source_file: Optional[str] = None
    row_start: Optional[int] = None
    row_end: Optional[int] = None


class AssistantChatResponse(_Base):
    client_id: int
    client_name: str
    summary: AssistantClaim
    insights: list[AssistantClaim] = Field(default_factory=list)
    suggestions: list[AssistantClaim] = Field(default_factory=list)
    citations: list[AssistantCitation] = Field(default_factory=list)


# ---------- Analytics / Risk (Control Tower + Digital Twin) ----------

class StageFailureCount(_Base):
    stage: TradeStatus
    count: int


class ClientFailureCount(_Base):
    client_id: int
    client_name: Optional[str] = None
    count: int


class ControlTowerResponse(_Base):
    total_trades: int
    done_trades: int
    stp_rate: float
    open_exceptions: int
    exception_rate: float
    avg_resolution_minutes: float
    top_failing_stages: list[StageFailureCount] = []
    top_failing_clients: list[ClientFailureCount] = []
    exceptions_today: int
    exceptions_yesterday: int


class LiveTradeSummary(_Base):
    id: int
    client_name: Optional[str] = None
    instrument: str
    status: TradeStatus
    last_successful_stage: Optional[TradeStatus] = None
    exception_stage: Optional[TradeStatus] = None
    updated_at: datetime


class RiskDailySummaryResponse(_Base):
    narrative: str
    generated_at: datetime


# ---------- Misc ----------

class HealthResponse(_Base):
    status: str
    database: str
    version: str


EmailLike = Annotated[
    str,
    Field(
        pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$",
        min_length=3,
        max_length=254,
        description="Email-like identifier; accepts .local / internal domains.",
    ),
]


# ---------- Auth / Users ----------

class LoginRequest(_Base):
    email: EmailLike
    password: str


class TokenResponse(_Base):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: "UserResponse"


class RegisterRequest(_Base):
    email: EmailLike
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)
    role: UserRole = UserRole.VIEWER


class UserResponse(_Base):
    id: int
    email: EmailLike
    full_name: str
    role: UserRole
    is_active: bool
    last_login_at: Optional[datetime]
    created_at: datetime


TokenResponse.model_rebuild()
