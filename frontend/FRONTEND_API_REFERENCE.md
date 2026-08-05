# Frontend API Reference

This document lists the API endpoints used by the frontend, the frontend files that call them, and short examples of how each request is sent and how the response is decoded.

## Base behavior

The frontend uses relative paths under `/api`, and Next.js rewrites them to the backend at `http://localhost:8000`.

```ts
// frontend/lib/api.ts
const API_BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}
```

---

## 1) Get trades

- URL: `GET /api/trades`
- Used in: [frontend/app/dashboard/page.tsx](app/dashboard/page.tsx)
- Purpose: Load the main trade list for the dashboard.

```ts
const [t, e] = await Promise.all([
  api.listTrades({ limit: 100 }),
  api.listExceptions({ status: "OPEN", limit: 50 }),
]);
setTrades(t.items);
```

How the response is decoded:

```ts
// frontend/lib/api.ts
return request<TradeListResponse>(`/trades${q ? `?${q}` : ""}`);
```

---

## 2) Get one trade

- URL: `GET /api/trades/{id}`
- Used in: [frontend/app/dashboard/page.tsx](app/dashboard/page.tsx)
- Purpose: Refresh a single trade after a real-time update.

```ts
api.getTrade(id).then((fresh) => {
  setTrades((prev) => [...prev]);
});
```

```ts
// frontend/lib/api.ts
getTrade: (id: number) => request<Trade>(`/trades/${id}`),
```

---

## 3) Create a trade

- URL: `POST /api/trades`
- Used in: [frontend/components/TradeEntryForm.tsx](components/TradeEntryForm.tsx)
- Purpose: Submit a normal trade from the main trade entry form.

```ts
const trade = submitFn
  ? await submitFn(body)
  : await api.createTrade(body);
```

```ts
// frontend/lib/api.ts
createTrade: (body) =>
  request<Trade>("/trades", {
    method: "POST",
    body: JSON.stringify(body),
  }),
```

---

## 4) Create a paper-trading trade

- URL: `POST /api/paper-trading/trades`
- Used in: [frontend/app/paper-trading/page.tsx](app/paper-trading/page.tsx)
- Purpose: Submit a simulated trade in the paper-trading environment.

```ts
submitFn={async (body) => (await api.createPaperTrade(body)) as Trade}
```

```ts
// frontend/lib/api.ts
createPaperTrade: (body) =>
  request<Trade>("/paper-trading/trades", {
    method: "POST",
    body: JSON.stringify(body),
  }),
```

---

## 5) Get exceptions

- URL: `GET /api/exceptions`
- Used in: [frontend/app/dashboard/page.tsx](app/dashboard/page.tsx), [frontend/app/exceptions/page.tsx](app/exceptions/page.tsx)
- Purpose: Load the exception queue for triage and dashboard summaries.

```ts
setItems(
  await api.listExceptions({
    status: tab,
    stage: stageFilter === "ALL" ? undefined : stageFilter,
    limit: 200,
  }),
);
```

```ts
// frontend/lib/api.ts
listExceptions: (params) => {
  const qs = new URLSearchParams();
  qs.set("status", params?.status ?? "OPEN");
  return request<TradeException[]>(`/exceptions?${qs.toString()}`);
},
```

---

## 6) Resolve an exception

- URL: `POST /api/exceptions/{id}/resolve`
- Used in: [frontend/components/ExceptionCard.tsx](components/ExceptionCard.tsx)
- Purpose: Resolve an exception with an optional resolution note.

```ts
const trade = await api.resolveException(exc.id, note.trim() || undefined);
```

```ts
// frontend/lib/api.ts
resolveException: (id, resolution_note) =>
  request<Trade>(`/exceptions/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ resolution_note: resolution_note ?? null }),
  }),
```

---

## 7) Get portfolio summary

- URL: `GET /api/portfolio/{clientId}`
- Used in: [frontend/app/portfolio/page.tsx](app/portfolio/page.tsx)
- Purpose: Load portfolio balances, positions, and P&L information for a selected client.

```ts
setData(await api.getPortfolio(clientId));
```

```ts
// frontend/lib/api.ts
getPortfolio: (clientId: number) =>
  request<PortfolioSummary>(`/portfolio/${clientId}`),
```

---

## 8) Parse a natural-language order

- URL: `POST /api/genai/parse-order`
- Used in: [frontend/components/TradeEntryForm.tsx](components/TradeEntryForm.tsx)
- Purpose: Convert a plain-English order into structured trade form values.

```ts
const res = await api.genaiParseOrder(nlPrompt, form.client_id);
setNlResult(res);
```

```ts
// frontend/lib/api.ts
genaiParseOrder: (prompt, default_client_id) =>
  request<GenaiParseOrderResponse>("/genai/parse-order", {
    method: "POST",
    body: JSON.stringify({ prompt, default_client_id }),
  }),
```

---

## 9) Explain an exception with AI

- URL: `POST /api/genai/explain-exception/{exceptionId}`
- Used in: [frontend/components/ExceptionCard.tsx](components/ExceptionCard.tsx)
- Purpose: Ask the AI service to explain the selected exception.

```ts
setExplain(await api.genaiExplainException(exc.id));
```

```ts
// frontend/lib/api.ts
genaiExplainException: (exceptionId: number) =>
  request<GenaiExplainExceptionResponse>(
    `/genai/explain-exception/${exceptionId}`,
    { method: "POST", body: "{}" },
  ),
```

---

## 10) WebSocket endpoint

- URL: `/ws/trades`
- Used in: [frontend/lib/websocket.ts](lib/websocket.ts)
- Purpose: Receive live trade and exception updates from the backend.

```ts
const WS_URL = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/trades`;
const ws = new WebSocket(WS_URL);
```

This is not a REST call, but it is an important frontend integration point for real-time updates.
