"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  History,
  Loader2,
} from "lucide-react";
import type { Trade, TradeHistoryEntry, TradeStatus } from "@/lib/types";
import { STAGE_LABELS } from "@/components/StageProgress";
import { api } from "@/lib/api";

interface TradeReplayProps {
  tradeId: number;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function stepKind(entry: TradeHistoryEntry): "exception" | "resolved-into" | "done" | "normal" {
  if (entry.to_status === "EXCEPTION") return "exception";
  if (entry.to_status === "DONE") return "done";
  if (entry.from_status === "EXCEPTION") return "resolved-into";
  return "normal";
}

export default function TradeReplay({ tradeId }: TradeReplayProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trade, setTrade] = useState<Trade | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getTrade(tradeId)
      .then((t) => {
        if (!cancelled) setTrade(t);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tradeId]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40">
      <div className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <History className="h-3.5 w-3.5" />
        Replay trade #{tradeId}
      </div>

      <div className="border-t border-slate-800 p-4">
        {loading && (
            <div className="flex items-center justify-center py-6 text-xs text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading trade history…
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
          {trade && trade.history.length > 0 && (
            <ol className="space-y-0">
              {trade.history.map((entry, idx) => {
                const kind = stepKind(entry);
                const isLast = idx === trade.history.length - 1;
                return (
                  <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {!isLast && (
                      <div
                        className={clsx(
                          "absolute left-[9px] top-5 h-full w-0.5",
                          kind === "exception" ? "bg-rose-500/30" : "bg-slate-700/60",
                        )}
                      />
                    )}
                    <div
                      className={clsx(
                        "relative z-10 mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-2",
                        kind === "exception" &&
                          "border-rose-500 bg-rose-500/15 text-rose-400",
                        kind === "resolved-into" &&
                          "border-amber-400 bg-amber-500/15 text-amber-300",
                        kind === "done" &&
                          "border-emerald-500 bg-emerald-500/15 text-emerald-400",
                        kind === "normal" &&
                          "border-indigo-400/70 bg-indigo-500/10 text-indigo-300",
                      )}
                    >
                      {kind === "exception" ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : kind === "done" ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Circle className="h-2 w-2 fill-current" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pt-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span
                          className={clsx(
                            "text-sm font-semibold",
                            kind === "exception" ? "text-rose-300" : "text-slate-100",
                          )}
                        >
                          {entry.from_status
                            ? `${STAGE_LABELS[entry.from_status as TradeStatus] ?? entry.from_status} → `
                            : ""}
                          {STAGE_LABELS[entry.to_status as TradeStatus] ?? entry.to_status}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {fmtTime(entry.created_at)}
                        </span>
                      </div>
                      {entry.note && (
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                          {entry.note}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        {trade && trade.history.length === 0 && (
          <div className="py-4 text-center text-xs text-slate-500">
            No history recorded for this trade yet.
          </div>
        )}
      </div>
    </div>
  );
}
