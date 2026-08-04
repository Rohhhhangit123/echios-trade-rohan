const API_BASE = "/api";
const TOKEN_KEY = "echios.auth.token";
const USER_KEY = "echios.auth.user";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {}
}

export function getStoredUser(): any | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: any | null) {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch {}
}

export function clearAuthStorage() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {}
}

async function request<T>(
  path: string,
  init?: RequestInit,
  opts?: { skipAuth?: boolean; skipAuthRedirect?: boolean },
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => (headers[k] = v));
    } else {
      Object.assign(headers, init.headers);
    }
  }
  if (!opts?.skipAuth) {
    const token = getStoredToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    if (!opts?.skipAuthRedirect && res.status === 401) {
      clearAuthStorage();
      if (typeof window !== "undefined") {
        const current = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?next=${current}`;
      }
    }
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
  GenaiExplainExceptionResponse,
  GenaiParseOrderResponse,
  LoginRequest,
  PortfolioSummary,
  RegisterRequest,
  TokenResponse,
  Trade,
  TradeException,
  TradeListResponse,
  User,
} from "./types";

export const api = {
  login: (payload: LoginRequest) =>
    request<TokenResponse>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      { skipAuth: true },
    ),

  register: (payload: RegisterRequest) =>
    request<TokenResponse>(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      { skipAuth: true },
    ),

  me: () => request<User>("/auth/me", {}, { skipAuthRedirect: true }),

  listUsers: () => request<User[]>("/auth/users"),

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
};
