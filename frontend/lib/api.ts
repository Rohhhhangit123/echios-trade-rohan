const API_BASE = "/api";

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    const detail =
      typeof parsed === "object" && parsed && "detail" in parsed
        ? (parsed as { detail: unknown }).detail
        : parsed;
    throw new Error(
      `HTTP ${res.status} ${res.statusText}${detail ? ` — ${JSON.stringify(detail)}` : ""}`,
    );
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

import type {
  AssistantChatResponse,
  AssistantHistoryMessage,
  GenaiExplainExceptionResponse,
  GenaiParseOrderResponse,
  PortfolioSummary,
  Trade,
  TradeException,
  TradeListResponse,
} from "./types";

export const api = {
  listTrades: (params?: {
    client_id?: number;
    status?: string;
    instrument?: string;
    simulated?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      });
    }
    const q = qs.toString();
    return request<TradeListResponse>(`/trades${q ? `?${q}` : ""}`);
  },

  getTrade: (id: number) => request<Trade>(`/trades/${id}`),

  createTrade: (body: {
    client_id: number;
    instrument: string;
    side: "BUY" | "SELL";
    quantity: string;
    price: string;
    currency?: string;
    counterparty_id?: number | null;
    settlement_mode?: "DVP" | "FOP";
  }) =>
    request<Trade>("/trades", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  createPaperTrade: (body: {
    client_id: number;
    instrument: string;
    side: "BUY" | "SELL";
    quantity: string;
    price: string;
    currency?: string;
    counterparty_id?: number | null;
    settlement_mode?: "DVP" | "FOP";
  }) =>
    request<Trade>("/paper-trading/trades", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listExceptions: (params?: {
    status?: "OPEN" | "RESOLVED";
    stage?: string;
    trade_id?: number;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set("status", params?.status ?? "OPEN");
    if (params?.stage) qs.set("stage", params.stage);
    if (params?.trade_id) qs.set("trade_id", String(params.trade_id));
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    return request<TradeException[]>(`/exceptions?${qs.toString()}`);
  },

  resolveException: (id: number, resolution_note?: string) =>
    request<Trade>(`/exceptions/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution_note: resolution_note ?? null }),
    }),

  getPortfolio: (clientId: number) =>
    request<PortfolioSummary>(`/portfolio/${clientId}`),

  genaiParseOrder: (prompt: string, default_client_id?: number) =>
    request<GenaiParseOrderResponse>("/genai/parse-order", {
      method: "POST",
      body: JSON.stringify({ prompt, default_client_id }),
    }),

  genaiExplainException: (exceptionId: number) =>
    request<GenaiExplainExceptionResponse>(
      `/genai/explain-exception/${exceptionId}`,
      { method: "POST", body: "{}" },
    ),

  assistantChat: (message: string, history: AssistantHistoryMessage[]) =>
    request<AssistantChatResponse>("/genai/assistant", {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
};
