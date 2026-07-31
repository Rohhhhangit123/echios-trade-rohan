"use client";

import clsx from "clsx";
import { useState } from "react";
import { AlertTriangle, CheckCircle, Loader2, Sparkles, Wrench } from "lucide-react";
import type { TradeException, GenaiExplainExceptionResponse } from "@/lib/types";
import { api } from "@/lib/api";

interface ExceptionCardProps {
  exc: TradeException;
  onResolved?: (updatedTradeId: number) => void;
}

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

  return (
    <div
      className={clsx(
        "rounded-xl border bg-slate-900/60 p-4 shadow-sm transition",
        open
          ? "border-rose-500/40 ring-1 ring-inset ring-rose-500/10"
          : "border-slate-800 opacity-80",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={clsx(
              "flex h-10 w-10 flex-none items-center justify-center rounded-lg",
              open ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300",
            )}
          >
            {open ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <CheckCircle className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-slate-300">
                #{exc.id}
              </span>
              <span
                className={clsx(
                  "rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ring-1 ring-inset",
                  open
                    ? "bg-rose-500/15 text-rose-300 ring-rose-500/30"
                    : "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
                )}
              >
                {exc.status}
              </span>
              <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
                {exc.stage}
              </span>
              {exc.trade_instrument && (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-semibold text-slate-200">
                  {exc.trade_instrument}
                </span>
              )}
              <span className="text-slate-500">
                Trade <span className="font-mono text-slate-300">#{exc.trade_id}</span>
              </span>
              {exc.trade_client_name && (
                <span className="text-slate-500">· {exc.trade_client_name}</span>
              )}
            </div>
            <div className="mt-1.5 text-sm text-slate-200">{exc.reason}</div>
            {exc.breaking_field && (
              <div className="mt-1 text-xs">
                <span className="text-slate-500">Breaking field: </span>
                <span className="font-mono text-rose-300">{exc.breaking_field}</span>
              </div>
            )}
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div>Created {new Date(exc.created_at).toLocaleString()}</div>
          {exc.resolved_at && (
            <div>Resolved {new Date(exc.resolved_at).toLocaleString()}</div>
          )}
        </div>
      </header>

      {exc.resolution_note && (
        <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-xs text-emerald-200">
          <span className="font-semibold">Resolution: </span>
          {exc.resolution_note}
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-3">
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

          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-widest text-slate-500">
              Resolution note (for audit trail)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. Manually confirmed KYC re-verified via compliance ticket #1234"
              className="w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleResolve}
              disabled={resolving}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-400 disabled:opacity-50"
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
      )}
    </div>
  );
}
