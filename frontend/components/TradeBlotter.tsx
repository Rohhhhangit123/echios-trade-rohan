"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ArrowUpRight, ArrowDownLeft, Eye } from "lucide-react";
import type { Trade } from "@/lib/types";
import StageProgress from "./StageProgress";

function fmtNumber(v: string | number, digits = 2) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

interface TradeBlotterProps {
  trades: Trade[];
  onView?: (trade: Trade) => void;
  highlightTradeId?: number | null;
}

export default function TradeBlotter({ trades, onView, highlightTradeId }: TradeBlotterProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return trades;
    const q = filter.toLowerCase();
    return trades.filter(
      (t) =>
        t.instrument.toLowerCase().includes(q) ||
        String(t.id).includes(q) ||
        (t.client_name ?? "").toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q),
    );
  }, [trades, filter]);

  return (
    <div className="glass-panel overflow-hidden rounded-2xl border border-slate-800/80 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-900/60 px-5 py-3.5 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="text-sm font-bold text-slate-100">Trade Blotter</div>
          <div className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-400">
            {filtered.length} trades
          </div>
        </div>
        <div className="w-72">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by ID, Instrument, Client…"
            className="w-full rounded-xl border border-slate-700/70 bg-slate-950/80 px-3.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-950/70 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="w-10 py-3"></th>
              <th className="px-3 py-3 text-left">ID</th>
              <th className="px-3 py-3 text-left">Client</th>
              <th className="px-3 py-3 text-left">Inst</th>
              <th className="px-3 py-3 text-left">Side</th>
              <th className="px-3 py-3 text-right">Qty</th>
              <th className="px-3 py-3 text-right">Price</th>
              <th className="px-3 py-3 text-right">Notional</th>
              <th className="px-3 py-3 text-left">Ccy</th>
              <th className="px-3 py-3 text-left">Mode</th>
              <th className="px-3 py-3 text-left">Status</th>
              <th className="px-3 py-3 text-right">Excs</th>
              <th className="px-3 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-16 text-center text-xs text-slate-500">
                  No trades. Submit one from <span className="font-mono text-indigo-300">/trade-entry</span>.
                </td>
              </tr>
            )}
            {filtered.map((t) => {
              const isBuy = t.side === "BUY";
              const expanded = expandedId === t.id;
              return (
                <>
                  <tr
                    key={t.id}
                    className={clsx(
                      "transition-colors",
                      expanded ? "bg-slate-800/50" : "hover:bg-slate-800/30",
                      highlightTradeId === t.id && "bg-indigo-500/5",
                    )}
                  >
                    <td className="py-3 pl-3 pr-1">
                      <button
                        onClick={() => setExpandedId(expanded ? null : t.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                      >
                        {expanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-400">#{t.id}</td>
                    <td className="px-3 py-3 text-slate-200">{t.client_name ?? `Client ${t.client_id}`}</td>
                    <td className="px-3 py-3 font-semibold tracking-tight text-white">{t.instrument}</td>
                    <td className="px-3 py-3">
                      <span
                        className={clsx(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold",
                          isBuy
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
                            : "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30",
                        )}
                      >
                        {isBuy ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                        {t.side}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-200">
                      {fmtNumber(t.filled_quantity || t.quantity, 0)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-300">
                      {fmtNumber(t.price, 2)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-100">
                      {fmtNumber(t.notional, 0)}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400">{t.currency}</td>
                    <td className="px-3 py-3 text-xs text-slate-400">
                      {t.simulated ? (
                        <span className="rounded bg-violet-500/10 px-1.5 py-0.5 font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30">
                          PAPER
                        </span>
                      ) : (
                        <span className="font-mono">{t.settlement_mode}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={t.status} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      {t.exception_count > 0 ? (
                        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-bold text-rose-300 ring-1 ring-inset ring-rose-500/30">
                          {t.exception_count}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {onView && (
                        <button
                          onClick={() => onView(t)}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-700 px-2 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-slate-950/40">
                      <td></td>
                      <td colSpan={12} className="px-4 pb-5 pr-6 pt-2">
                        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
                            <div>ISIN: <span className="font-mono text-slate-200">{t.isin ?? "—"}</span></div>
                            <div>Entity: <span className="text-slate-200">{t.entity ?? "—"}</span></div>
                            <div>Last OK stage: <span className="text-indigo-300">{t.last_successful_stage ?? "—"}</span></div>
                            <div>Parent: <span className="font-mono text-slate-200">{t.parent_trade_id ?? "—"}</span></div>
                            <div>Created: <span className="text-slate-200">{new Date(t.created_at).toLocaleString()}</span></div>
                            <div>Updated: <span className="text-slate-200">{new Date(t.updated_at).toLocaleString()}</span></div>
                          </div>
                          <div className="mb-3 text-[11px] uppercase tracking-widest text-slate-500">Pipeline</div>
                          <StageProgress
                            status={t.status}
                            lastSuccessfulStage={t.last_successful_stage}
                            exceptionStage={
                              t.status === "EXCEPTION"
                                ? t.history.findLast?.((h) => h.to_status === "EXCEPTION")?.from_status ?? null
                                : null
                            }
                          />
                          {t.history && t.history.length > 0 && (
                            <>
                              <div className="mt-5 mb-2 text-[11px] uppercase tracking-widest text-slate-500">
                                History ({t.history.length})
                              </div>
                              <ol className="space-y-1.5 text-xs text-slate-300">
                                {t.history.map((h) => (
                                  <li
                                    key={h.id}
                                    className="flex items-start gap-3 rounded-md border border-slate-800/60 bg-slate-950/40 px-3 py-2"
                                  >
                                    <div className="font-mono text-[10px] text-slate-500">
                                      {new Date(h.created_at).toLocaleTimeString()}
                                    </div>
                                    <div className="flex-1">
                                      <span className="font-mono text-[11px] text-slate-400">
                                        {h.from_status ?? "∅"} →{" "}
                                      </span>
                                      <span className="font-semibold text-slate-100">{h.to_status}</span>
                                      {h.note && (
                                        <div className="mt-0.5 text-[11px] text-slate-400">{h.note}</div>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ol>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Trade["status"] }) {
  const isDone = status === "DONE";
  const isException = status === "EXCEPTION";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide border",
        isDone
          ? "pill-filled"
          : isException
            ? "pill-rejected"
            : "pill-routed",
      )}
    >
      <span
        className={clsx(
          "h-1.5 w-1.5 rounded-full",
          isDone ? "bg-emerald-400" : isException ? "bg-rose-400" : "bg-blue-400 animate-pulse",
        )}
      />
      {status === "DONE" ? "Filled" : status === "EXCEPTION" ? "Exception" : status}
    </span>
  );
}
