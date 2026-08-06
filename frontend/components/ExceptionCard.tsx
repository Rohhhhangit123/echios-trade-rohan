"use client";

import clsx from "clsx";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { TradeException, GenaiExplainExceptionResponse } from "@/lib/types";
import { api } from "@/lib/api";
import TradeReplay from "@/components/TradeReplay";

interface ExceptionCardProps {
  exc: TradeException;
  onResolved?: (updatedTradeId: number) => void;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const BREAKING_FIELD_LABELS: Record<string, string> = {
  kyc_status: "KYC status",
  kyc_expiry: "KYC expiry",
  client_id: "Client",
  instrument: "Instrument",
  quantity: "Quantity",
  price: "Price",
  filled_quantity: "Filled qty",
  currency: "Currency",
  counterparty_id: "Counterparty",
  settlement_mode: "Settlement mode",
};

export default function ExceptionCard({ exc, onResolved }: ExceptionCardProps) {
  const open = exc.status === "OPEN";
  const [note, setNote] = useState("");
  const [resolving, setResolving] = useState(false);
  const [explain, setExplain] = useState<GenaiExplainExceptionResponse | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  async function handleResolve() {
    setResolving(true);
    try {
      const trade = await api.resolveException(exc.id, note.trim() || undefined);
      onResolved?.(trade.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  }

  async function handleExplain() {
    setExplainLoading(true);
    setExplainError(null);
    try {
      setExplain(await api.genaiExplainException(exc.id));
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : String(e));
    } finally {
      setExplainLoading(false);
    }
  }

  const fieldLabel = exc.breaking_field
    ? BREAKING_FIELD_LABELS[exc.breaking_field] ?? exc.breaking_field
    : null;

  return (
    <div
      className={clsx(
        "grid grid-cols-1 overflow-hidden rounded-2xl border bg-slate-900/60 shadow-sm sm:grid-cols-[220px_1fr]",
        open ? "border-slate-800" : "border-slate-800/70 opacity-90",
      )}
    >
      {/* Left identity sidebar */}
      <div className="border-b border-slate-800 bg-slate-950/40 p-5 sm:border-b-0 sm:border-r">
        <span
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            open
              ? "bg-rose-500/15 text-rose-300"
              : "bg-emerald-500/15 text-emerald-300",
          )}
        >
          {open ? (
            <Circle className="h-2 w-2 fill-current" />
          ) : (
            <CheckCircle2 className="h-3 w-3" />
          )}
          {open ? "Open" : "Resolved"}
        </span>

        {exc.trade_instrument && (
          <div className="mt-3 text-2xl font-bold tracking-tight text-white">
            {exc.trade_instrument}
          </div>
        )}

        <span className="mt-2 inline-block rounded-md bg-indigo-500/15 px-2 py-1 text-[11px] font-mono font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
          {exc.stage}
        </span>

        <dl className="mt-5 space-y-3 text-xs">
          <div>
            <dt className="font-semibold uppercase tracking-wider text-slate-500">Exception</dt>
            <dd className="mt-0.5 font-mono text-slate-300">#{exc.id}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wider text-slate-500">Trade</dt>
            <dd className="mt-0.5 text-slate-300">
              <span className="font-mono">#{exc.trade_id}</span>
              {exc.trade_client_name && (
                <>
                  {" "}
                  · <span className="text-slate-400">{exc.trade_client_name}</span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wider text-slate-500">
              {open ? "Flagged" : "Resolved"}
            </dt>
            <dd
              className="mt-0.5 text-slate-300"
              title={new Date(open ? exc.created_at : exc.resolved_at ?? exc.created_at).toLocaleString()}
            >
              {timeAgo(open ? exc.created_at : exc.resolved_at ?? exc.created_at)}
            </dd>
          </div>
        </dl>
      </div>

      {/* Right detail + action panel */}
      <div className="p-5">
        {fieldLabel && (
          <div className="text-xs font-bold uppercase tracking-wider text-rose-400">
            {fieldLabel} broke this trade
          </div>
        )}
        <p className="mt-1.5 text-[15px] leading-relaxed text-slate-100">{exc.reason}</p>

        {open ? (
          <div className="mt-4 space-y-3">
            <TradeReplay tradeId={exc.trade_id} />

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleExplain}
                disabled={explainLoading}
                className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {explainLoading ? "Claude thinking…" : "Explain with AI"}
              </button>
              {explainError && (
                <span className="text-xs text-rose-400">{explainError}</span>
              )}
            </div>

            {explain && (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-xs">
                <div className="mb-1 font-semibold text-violet-200">Summary</div>
                <div className="text-slate-200">{explain.summary}</div>
                {explain.likely_root_cause && (
                  <>
                    <div className="mb-1 mt-3 font-semibold text-violet-200">Likely root cause</div>
                    <div className="text-slate-200">{explain.likely_root_cause}</div>
                  </>
                )}
                {explain.suggested_fix && (
                  <>
                    <div className="mb-1 mt-3 font-semibold text-violet-200">Suggested fix</div>
                    <div className="text-slate-200">{explain.suggested_fix}</div>
                  </>
                )}
              </div>
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Resolution note
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Resolution note for the audit trail…"
                className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleResolve}
                  disabled={resolving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-900 shadow-sm hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resolving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Re-running pipeline…
                    </>
                  ) : (
                    <>
                      <Wrench className="h-3.5 w-3.5" />
                      Resolve & re-run stage
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {exc.resolution_note && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Resolution
                  </div>
                  {exc.resolved_at && (
                    <span className="text-[11px] text-emerald-400/70">
                      {timeAgo(exc.resolved_at)}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-slate-200">{exc.resolution_note}</p>
              </div>
            )}
            <TradeReplay tradeId={exc.trade_id} />
          </div>
        )}
      </div>
    </div>
  );
}
