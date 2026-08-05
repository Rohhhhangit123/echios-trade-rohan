"use client";

import { useCallback, useState } from "react";
import clsx from "clsx";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Send,
  Sparkles,
  XCircle,
} from "lucide-react";

import { api } from "@/lib/api";
import type {
  GenaiParseOrderResponse,
  Trade,
  Side,
} from "@/lib/types";
import StageProgress from "./StageProgress";
import { useEffect, useRef } from "react"; // add useEffect, useRef to existing useState/useCallback import
import { useLiveTick } from "@/hooks/useLiveTick";

const CLIENT_CHOICES: Array<{ id: number; label: string }> = [
  { id: 1, label: "#1 Acme Capital Partners (KYC OK)" },
  { id: 2, label: "#2 Globex Asset Management (KYC OK)" },
  { id: 3, label: "#3 Initech Hedge Fund (KYC EXPIRED — will throw EXCEPTION)" },
  { id: 4, label: "#4 Umbrella Corp Pension (KYC OK)" },
  { id: 5, label: "#5 Stark Industries Treasury (KYC PENDING — will throw EXCEPTION)" },
];

const INSTRUMENT_CHOICES = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META",
  "TCS", "RELIANCE", "VOD", "BP",
];

type FormState = {
  client_id: number;
  instrument: string;
  side: Side;
  quantity: string;
  price: string;
  currency: string;
  settlement_mode: "DVP" | "FOP";
};

const DEFAULTS: FormState = {
  client_id: 1,
  instrument: "AAPL",
  side: "BUY",
  quantity: "500",
  price: "190.50",
  currency: "USD",
  settlement_mode: "DVP",
};

export interface TradeEntryFormProps {
  submitFn?: (body: Omit<FormState, "settlement_mode"> & { settlement_mode?: "DVP" | "FOP" }) => Promise<Trade>;
  modeLabel?: string;
  accentTone?: "indigo" | "violet";
}

export default function TradeEntryForm({
  submitFn,
  modeLabel = "STP trade",
  accentTone = "indigo",
}: TradeEntryFormProps) {
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    trade: Trade | null;
    ok: boolean;
    error?: string;
  } | null>(null);
  const [lastSubmittedAt, setLastSubmittedAt] = useState<Date | null>(null);

  const [nlPrompt, setNlPrompt] = useState(
    "buy 500 NVDA at 120 for Acme Capital",
  );
  const [nlParsing, setNlParsing] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlResult, setNlResult] = useState<GenaiParseOrderResponse | null>(null);

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const doSubmit = useCallback(async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const body = {
        client_id: form.client_id,
        instrument: form.instrument.toUpperCase(),
        side: form.side,
        quantity: form.quantity,
        price: form.price,
        currency: form.currency,
        settlement_mode: form.settlement_mode,
      };
      const trade = submitFn
        ? await submitFn(body)
        : await api.createTrade(body);
      setResult({ trade, ok: trade.status !== "EXCEPTION" });
      setLastSubmittedAt(new Date());
    } catch (e) {
      setResult({
        trade: null,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitting(false);
    }
  }, [form, submitFn]);

  const doNlParse = useCallback(async () => {
    setNlParsing(true);
    setNlError(null);
    setNlResult(null);
    try {
      const res = await api.genaiParseOrder(nlPrompt, form.client_id);
      setNlResult(res);

      const p = res.parsed;
      const next: Partial<FormState> = {};
      if (p.instrument) next.instrument = p.instrument.toUpperCase();
      if (p.side) next.side = p.side;
      if (p.quantity) next.quantity = p.quantity;
      if (p.price) next.price = p.price;
      if (p.currency) next.currency = p.currency.toUpperCase();
      if (Object.keys(next).length > 0) {
        setForm((prev) => ({ ...prev, ...next }));
      }
    } catch (e) {
      setNlError(e instanceof Error ? e.message : String(e));
    } finally {
      setNlParsing(false);
    }
  }, [nlPrompt, form.client_id]);

  const toneClasses = {
    primary:
      accentTone === "violet"
        ? "bg-violet-500 hover:bg-violet-400"
        : "bg-indigo-500 hover:bg-indigo-400",
    ring:
      accentTone === "violet"
        ? "focus:border-violet-500 focus:ring-violet-500/30 border-violet-500 box-shadow_violet"
        : "focus:border-indigo-500 focus:ring-indigo-500/30",
    icon: accentTone === "violet" ? "text-violet-400" : "text-indigo-400",
    spreadBadge:
      accentTone === "violet"
        ? "bg-violet-500/15 text-violet-200 ring-violet-500/30"
        : "bg-indigo-500/15 text-indigo-200 ring-indigo-500/30",
  };
  const { tick } = useLiveTick(form.instrument);
  const hasPrefilled = useRef(false);

  // Prefill the price field exactly once, the first time a live tick
  // arrives after mount. Never fires again after that (not on instrument
  // change, not on subsequent polls) — the field is fully user-owned
  // after this point, same as before.
  useEffect(() => {
    if (tick && !hasPrefilled.current) {
      setForm((prev) => ({ ...prev, price: String(tick.mid) }));
      hasPrefilled.current = true;
    }
  }, [tick]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* Left: Form */}
      <div className="space-y-6 lg:col-span-3">
        <NaturalLanguagePanel
          toneIconClass={toneClasses.icon}
          primaryClass={toneClasses.primary}
          nlPrompt={nlPrompt}
          setNlPrompt={setNlPrompt}
          doNlParse={doNlParse}
          nlParsing={nlParsing}
          nlError={nlError}
          nlResult={nlResult}
        />

        {/* Structured form */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-sm">
          <div className="mb-4 text-sm font-semibold text-slate-100">Structured order ticket</div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Client account</Label>
              <select
                value={form.client_id}
                onChange={(e) => setField("client_id", parseInt(e.target.value, 10))}
                className={inputClass}
              >
                {CLIENT_CHOICES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Instrument</Label>
              <select
                value={form.instrument}
                onChange={(e) => setField("instrument", e.target.value)}
                className={inputClass}
              >
                {INSTRUMENT_CHOICES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Side</Label>
              <div className="grid grid-cols-2 gap-2">
                <SideButton
                  active={form.side === "BUY"}
                  onClick={() => setField("side", "BUY")}
                  label="Buy"
                  tone="BUY"
                />
                <SideButton
                  active={form.side === "SELL"}
                  onClick={() => setField("side", "SELL")}
                  label="Sell"
                  tone="SELL"
                />
              </div>
            </div>

            <div>
              <Label>Quantity</Label>
              <input
                type="number"
                min={0}
                step={1}
                value={form.quantity}
                onChange={(e) => setField("quantity", e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <Label>Price</Label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={(e) => setField("price", e.target.value)}
                className={inputClass}
              />
              {tick && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className={clsx(
                      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                      toneClasses.spreadBadge,
                    )}
                  >
                    {tick.spread.toFixed(2)} spread
                  </span>
                  <span className="text-[11px] text-slate-500">
                    bid <span className="font-mono text-slate-400">{tick.bid.toFixed(2)}</span>
                    {" — "}
                    ask <span className="font-mono text-slate-400">{tick.ask.toFixed(2)}</span>
                  </span>
                </div>
              )}
            </div>

            <div>
              <Label>Currency</Label>
              <input
                value={form.currency}
                onChange={(e) => setField("currency", e.target.value.toUpperCase().slice(0, 3))}
                className={`${inputClass} uppercase`}
                maxLength={3}
              />
            </div>

            <div>
              <Label>Settlement mode</Label>
              <select
                value={form.settlement_mode}
                onChange={(e) => setField("settlement_mode", e.target.value as "DVP" | "FOP")}
                className={inputClass}
              >
                <option value="DVP">DVP — Delivery vs Payment (linked)</option>
                <option value="FOP">FOP — Free of Payment (unlinked)</option>
              </select>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div className="text-xs text-slate-400">
              Notional:{" "}
              <span className="font-mono font-semibold text-slate-100">
                {(
                  (parseFloat(form.quantity) || 0) * (parseFloat(form.price) || 0)
                ).toLocaleString(undefined, {
                  style: "currency",
                  currency: form.currency || "USD",
                  maximumFractionDigits: 0,
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setForm(DEFAULTS)}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                type="button"
              >
                Reset
              </button>
              <button
                onClick={doSubmit}
                disabled={submitting}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-50",
                  toneClasses.primary,
                )}
                type="button"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {submitting ? "Running pipeline…" : `Submit ${modeLabel}`}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Right: Result panel */}
      <div className="lg:col-span-2">
        <div className="sticky top-20 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">Pipeline result</h3>
              {lastSubmittedAt && (
                <span className="text-[10px] text-slate-500">
                  {lastSubmittedAt.toLocaleTimeString()}
                </span>
              )}
            </div>

            {!result && !submitting && (
              <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center text-xs text-slate-500">
                Submit a trade to see the pipeline run here.
              </div>
            )}

            {submitting && (
              <div className="flex flex-col items-center gap-3 rounded-lg bg-slate-950/50 p-8 text-xs text-slate-300">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                Running 11-stage STP pipeline synchronously…
              </div>
            )}

            {result && result.error && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                <div className="mb-1 flex items-center gap-1.5 font-semibold text-rose-200">
                  <XCircle className="h-3.5 w-3.5" />
                  Request failed
                </div>
                <div className="font-mono text-[11px] text-rose-300/90">
                  {result.error}
                </div>
              </div>
            )}

            {result && result.trade && (
              <div className="space-y-3">
                <div
                  className={clsx(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ring-1 ring-inset",
                    result.ok
                      ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"
                      : "bg-rose-500/10 text-rose-200 ring-rose-500/30",
                  )}
                >
                  {result.ok ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {result.ok
                    ? `Pipeline complete — status ${result.trade.status}`
                    : `Dropped to EXCEPTION at stage ${result.trade.last_successful_stage ?? "ONBOARDED"}`}
                  <span className="ml-auto font-mono text-[11px] opacity-80">
                    #{result.trade.id}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-950/50 p-3 text-xs">
                  <KV k="Instrument" v={result.trade.instrument} mono />
                  <KV k="Side" v={result.trade.side} />
                  <KV
                    k="Qty (filled)"
                    v={`${parseFloat(result.trade.filled_quantity).toLocaleString()} / ${parseFloat(result.trade.quantity).toLocaleString()}`}
                  />
                  <KV k="Price" v={parseFloat(result.trade.price).toFixed(2)} />
                  <KV
                    k="Notional"
                    v={parseFloat(result.trade.notional).toLocaleString(undefined, {
                      style: "currency",
                      currency: result.trade.currency,
                      maximumFractionDigits: 0,
                    })}
                  />
                  <KV k="Mode" v={result.trade.settlement_mode} />
                  <KV k="ISIN" v={result.trade.isin ?? "—"} mono />
                  <KV k="Entity" v={result.trade.entity ?? "—"} />
                </div>

                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-500">
                    Pipeline
                  </div>
                  <StageProgress
                    status={result.trade.status}
                    lastSuccessfulStage={result.trade.last_successful_stage}
                    exceptionStage={
                      result.trade.status === "EXCEPTION"
                        ? result.trade.last_successful_stage ?? "ONBOARDED"
                        : null
                    }
                  />
                </div>

                {result.trade.history && result.trade.history.length > 0 && (
                  <div className="max-h-52 space-y-1.5 overflow-auto rounded-lg bg-slate-950/50 p-2 text-xs">
                    <div className="mb-1 px-1 text-[10px] uppercase tracking-widest text-slate-500">
                      Audit trail
                    </div>
                    {result.trade.history.map((h) => (
                      <div
                        key={h.id}
                        className="flex items-start gap-2 rounded-md border border-slate-800/60 bg-slate-900/60 px-2 py-1.5"
                      >
                        <span className="mt-0.5 font-mono text-[10px] text-slate-500">
                          {new Date(h.created_at).toLocaleTimeString()}
                        </span>
                        <span className="flex-1 text-slate-200">
                          <span className="font-mono text-slate-400">
                            {h.from_status ?? "∅"} →{" "}
                          </span>
                          <span className="font-semibold">{h.to_status}</span>
                          {h.note && (
                            <div className="text-[11px] text-slate-400">{h.note}</div>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 transition focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
      {children}
    </label>
  );
}

function SideButton({
  active,
  onClick,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone: "BUY" | "SELL";
}) {
  const Icon = tone === "BUY" ? ArrowUpRight : ArrowDownLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition border",
        active
          ? tone === "BUY"
            ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/50 shadow-inner"
            : "bg-rose-500/20 text-rose-200 border-rose-500/50 shadow-inner"
          : "bg-slate-950 text-slate-400 hover:bg-slate-800/50 border-slate-700",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function KV({
  k,
  v,
  mono,
}: {
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {k}
      </div>
      <div className={clsx("truncate text-slate-200", mono && "font-mono")}>
        {v}
      </div>
    </div>
  );
}

function NaturalLanguagePanel(props: {
  toneIconClass: string;
  primaryClass: string;
  nlPrompt: string;
  setNlPrompt: (s: string) => void;
  doNlParse: () => Promise<void>;
  nlParsing: boolean;
  nlError: string | null;
  nlResult: GenaiParseOrderResponse | null;
}) {
  const {
    toneIconClass,
    primaryClass,
    nlPrompt,
    setNlPrompt,
    doNlParse,
    nlParsing,
    nlError,
    nlResult,
  } = props;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Sparkles className={clsx("h-4 w-4", toneIconClass)} />
          Natural-language order
        </div>
        <span className="text-[10px] uppercase tracking-widest text-slate-500">
          powered by Claude
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={nlPrompt}
          onChange={(e) => setNlPrompt(e.target.value)}
          placeholder='e.g. "sell 1000 TSLA at 250.00 for Umbrella Corp" or "buy 100 AAPL at market"'
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              doNlParse();
            }
          }}
        />
        <button
          onClick={doNlParse}
          disabled={nlParsing}
          className={clsx(
            "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-50",
            primaryClass,
          )}
          type="button"
        >
          {nlParsing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {nlParsing ? "Parsing…" : "Parse & fill form"}
        </button>
      </div>
      {nlError && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {nlError}
        </div>
      )}
      {nlResult && (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <div className="font-semibold text-slate-200">Parsed</div>
            <div
              className={clsx(
                "rounded-full px-2 py-0.5 text-[10px] font-bold",
                nlResult.parsed.confidence >= 0.85
                  ? "bg-emerald-500/15 text-emerald-300"
                  : nlResult.parsed.confidence >= 0.5
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-rose-500/15 text-rose-300",
              )}
            >
              confidence {(nlResult.parsed.confidence * 100).toFixed(0)}%
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-300 sm:grid-cols-3">
            {(["instrument", "side", "quantity", "price", "currency", "at_market"] as const).map((k) => (
              <div key={k} className="truncate">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  {k.replace("_", " ")}:{" "}
                </span>
                <span className="font-mono">
                  {String((nlResult.parsed as unknown as Record<string, unknown>)[k] ?? "—")}
                </span>
              </div>
            ))}
          </div>
          {nlResult.parsed.notes && (
            <div className="mt-2 text-slate-400">
              <span className="font-semibold">Notes: </span>
              {nlResult.parsed.notes}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
