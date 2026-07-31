export type TradeStatus =
  | "ONBOARDED"
  | "EXECUTED"
  | "CAPTURED"
  | "ENRICHED"
  | "ALLOCATED"
  | "VALIDATED"
  | "CONFIRMED"
  | "FUNDED"
  | "SETTLED"
  | "RECONCILED"
  | "DONE"
  | "EXCEPTION";

export const STAGE_ORDER: TradeStatus[] = [
  "ONBOARDED",
  "EXECUTED",
  "CAPTURED",
  "ENRICHED",
  "ALLOCATED",
  "VALIDATED",
  "CONFIRMED",
  "FUNDED",
  "SETTLED",
  "RECONCILED",
  "DONE",
];

export type Side = "BUY" | "SELL";
export type ExceptionStatus = "OPEN" | "RESOLVED";
export type SettlementMode = "DVP" | "FOP";
export type KycStatus = "PENDING" | "VERIFIED" | "EXPIRED" | "REJECTED";

export interface TradeHistoryEntry {
  id: number;
  from_status: TradeStatus | null;
  to_status: TradeStatus;
  note: string | null;
  created_at: string;
}

export interface Trade {
  id: number;
  client_id: number;
  client_name: string | null;
  instrument: string;
  side: Side;
  quantity: string;
  filled_quantity: string;
  price: string;
  currency: string;
  status: TradeStatus;
  last_successful_stage: TradeStatus | null;
  parent_trade_id: number | null;
  simulated: boolean;
  counterparty_id: number | null;
  settlement_mode: SettlementMode;
  settlement_failed: boolean;
  isin: string | null;
  entity: string | null;
  notional: string;
  created_at: string;
  updated_at: string;
  history: TradeHistoryEntry[];
  exception_count: number;
}

export interface TradeListResponse {
  items: Trade[];
  total: number;
}

export interface TradeException {
  id: number;
  trade_id: number;
  stage: TradeStatus;
  reason: string;
  breaking_field: string | null;
  status: ExceptionStatus;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  trade_instrument: string | null;
  trade_client_name: string | null;
}

export interface Position {
  client_id: number;
  instrument: string;
  quantity: string;
  avg_price: string;
  current_price: string;
  market_value: string;
  unrealized_pnl: string;
  unrealized_pnl_pct: string;
  updated_at: string;
}

export interface PortfolioSummary {
  client_id: number;
  client_name: string | null;
  positions: Position[];
  total_market_value: string;
  total_cost_basis: string;
  total_unrealized_pnl: string;
  total_unrealized_pnl_pct: string;
  nostro_balance: string;
}

export interface ParsedOrder {
  instrument: string | null;
  side: Side | null;
  quantity: string | null;
  price: string | null;
  at_market: boolean;
  currency: string;
  confidence: number;
  notes: string | null;
}

export interface GenaiParseOrderResponse {
  parsed: ParsedOrder;
  raw_summary: string;
}

export interface GenaiExplainExceptionResponse {
  summary: string;
  likely_root_cause: string | null;
  suggested_fix: string | null;
  raw: string | null;
}

export interface WsMessage {
  type:
    | "system"
    | "echo"
    | "trade_updated"
    | "exception_created"
    | "exception_resolved";
  message?: string;
  connected_clients?: number;
  client_id?: string;
  trade_id?: number;
  status?: TradeStatus;
  exception_id?: number;
  stage?: TradeStatus;
  reason?: string;
  breaking_field?: string | null;
}
