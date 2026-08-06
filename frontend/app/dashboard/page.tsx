"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";

import { api } from "@/lib/api";
import { useTradeWebSocket } from "@/lib/websocket";
import type { Trade, TradeException } from "@/lib/types";
import TradeBlotter from "@/components/TradeBlotter";
import StageProgress from "@/components/StageProgress";

const STAGE_COUNT = 11;

export default function DashboardPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [exceptions, setExceptions] = useState<TradeException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flashTradeId, setFlashTradeId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const onWsMessage = useCallback((msg: Parameters<typeof useTradeWebSocket>[0]) => undefined, []);
  const { connected, lastMessage } = useTradeWebSocket();

  const refreshAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [t, e] = await Promise.all([
        api.listTrades({ limit: 100 }),
        api.listExceptions({ status: "OPEN", limit: 50 }),
      ]);
      setTrades(t.items);
      setExceptions(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage;

    if (msg.type === "trade_updated" && msg.trade_id) {
      const id = msg.trade_id;

      setFlashTradeId(id);
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlashTradeId(null), 3000);

      setToast(
        `Trade #${id} ${msg.status ? `→ ${msg.status}` : "updated"}`,
      );
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);

      api
        .getTrade(id)
        .then((fresh) => {
          setTrades((prev) => {
            const idx = prev.findIndex((t) => t.id === id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = fresh;
              next.sort(
                (a, b) =>
                  new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime(),
              );
              return next;
            }
            return [fresh, ...prev].sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
            );
          });
        })
        .catch(() => {
          /* swallow — refreshAll next click covers it */
        });

      if (msg.status === "EXCEPTION") {
        api
          .listExceptions({ status: "OPEN", limit: 50 })
          .then((e) => setExceptions(e))
          .catch(() => undefined);
      }
    }

    if (msg.type === "exception_created") {
      api
        .listExceptions({ status: "OPEN", limit: 50 })
        .then((e) => setExceptions(e))
        .catch(() => undefined);
      setToast(
        `New exception at ${msg.stage}${msg.reason ? `: ${msg.reason.slice(0, 80)}` : ""}`,
      );
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(null), 5000);
    }

    if (msg.type === "exception_resolved") {
      api
        .listExceptions({ status: "OPEN", limit: 50 })
        .then((e) => setExceptions(e))
        .catch(() => undefined);
      setToast(`Exception #${msg.exception_id} resolved & re-running`);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
    }
  }, [lastMessage]);

  const stats = useMemo(() => {
    const total = trades.length;
    const done = trades.filter((t) => t.status === "DONE").length;
    const exc = trades.filter((t) => t.status === "EXCEPTION").length;
    const inflight = total - done - exc;
    const notional = trades.reduce(
      (sum, t) => sum + (parseFloat(t.notional) || 0),
      0,
    );
    const avgStageIdx =
      trades.length === 0
        ? 0
        : trades.reduce((sum, t) => {
            const stage = t.status;
            if (stage === "EXCEPTION") {
              const lastOk = t.last_successful_stage;
              if (!lastOk) return sum;
              const [ONBOARDED, EXECUTED, CAPTURED, ENRICHED, ALLOCATED, VALIDATED, CONFIRMED, FUNDED, SETTLED, RECONCILED, DONE] =
                ["ONBOARDED", "EXECUTED", "CAPTURED", "ENRICHED", "ALLOCATED", "VALIDATED", "CONFIRMED", "FUNDED", "SETTLED", "RECONCILED", "DONE"];
              const all = [ONBOARDED, EXECUTED, CAPTURED, ENRICHED, ALLOCATED, VALIDATED, CONFIRMED, FUNDED, SETTLED, RECONCILED, DONE];
              return sum + (all.indexOf(lastOk) + 1);
            }
            const [ONBOARDED, EXECUTED, CAPTURED, ENRICHED, ALLOCATED, VALIDATED, CONFIRMED, FUNDED, SETTLED, RECONCILED, DONE] =
              ["ONBOARDED", "EXECUTED", "CAPTURED", "ENRICHED", "ALLOCATED", "VALIDATED", "CONFIRMED", "FUNDED", "SETTLED", "RECONCILED", "DONE"];
            const all = [ONBOARDED, EXECUTED, CAPTURED, ENRICHED, ALLOCATED, VALIDATED, CONFIRMED, FUNDED, SETTLED, RECONCILED, DONE];
            return sum + (all.indexOf(stage) + 1);
          }, 0) / trades.length;
    return { total, done, exc, inflight, notional, avgStageIdx };
  }, [trades]);

  const latestTrade = trades[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-indigo-400">
            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
            STP Operations Hub
          </div>
          <h1 className="mt-1 flex items-center gap-2.5 text-2xl font-black tracking-tight text-white sm:text-3xl">
            <Activity className="h-7 w-7 text-indigo-400" />
            Live Trade Operations
          </h1>
          <p className="mt-1 text-xs text-slate-400 sm:text-sm">
            Real-time Straight-Through Processing: 11-stage automated pipeline.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold backdrop-blur-md transition-all",
              connected
                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 glow-emerald"
                : "border border-amber-500/30 bg-amber-500/10 text-amber-300",
            )}
          >
            <span className={clsx("h-2 w-2 rounded-full", connected ? "bg-emerald-400 animate-ping" : "bg-amber-400")} />
            {connected ? "LIVE WEBSOCKET" : "RECONNECTING…"}
          </div>
          <button
            onClick={refreshAll}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-4 py-2 text-xs font-semibold text-slate-200 shadow-md transition hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />
            Sync
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Total Trades"
          value={stats.total.toLocaleString()}
          icon={<Activity className="h-4 w-4" />}
          tone="indigo"
        />
        <StatCard
          label="In-Flight"
          value={stats.inflight.toLocaleString()}
          icon={<Loader2 className="h-4 w-4 animate-spin" />}
          tone="sky"
        />
        <StatCard
          label="Completed"
          value={stats.done.toLocaleString()}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
        />
        <StatCard
          label="Exceptions"
          value={exceptions.length.toLocaleString()}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={exceptions.length > 0 ? "rose" : "slate"}
          badgeHref="/exceptions"
        />
        <StatCard
          label="Notional Traded"
          value={
            stats.notional === 0
              ? "—"
              : `$${(stats.notional / 1_000_000).toFixed(2)}M`
          }
          icon={<TrendingUp className="h-4 w-4" />}
          tone="violet"
        />
        <StatCard
          label="Avg Pipeline Stage"
          value={`${stats.avgStageIdx.toFixed(1)} / ${STAGE_COUNT}`}
          icon={<Zap className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <XCircle className="mt-0.5 h-4 w-4 flex-none" />
          <div>
            <div className="font-semibold">Failed to load data</div>
            <div className="mt-0.5 font-mono text-xs text-rose-300/90">
              {error}
            </div>
          </div>
        </div>
      )}

      {/* Latest trade spotlight with StageProgress */}
      {latestTrade && (
        <section className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900/80 to-indigo-950/30 p-5 shadow">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-500">
                Latest trade — signature pipeline view
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs text-slate-400">
                  #{latestTrade.id}
                </span>
                <span className="text-lg font-bold text-white">
                  {latestTrade.side}{" "}
                  <span className="font-mono tabular-nums text-indigo-200">
                    {parseFloat(latestTrade.quantity).toLocaleString()}
                  </span>{" "}
                  <span className="text-indigo-300">{latestTrade.instrument}</span>{" "}
                  <span className="text-slate-300">
                    @ ${parseFloat(latestTrade.price).toFixed(2)}
                  </span>
                </span>
                <span className="text-xs text-slate-400">
                  {latestTrade.client_name ?? `Client ${latestTrade.client_id}`}
                </span>
                <span
                  className={clsx(
                    "rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset",
                    latestTrade.status === "DONE"
                      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40"
                      : latestTrade.status === "EXCEPTION"
                        ? "bg-rose-500/20 text-rose-200 ring-rose-500/40"
                        : "bg-indigo-500/15 text-indigo-200 ring-indigo-500/40",
                  )}
                >
                  {latestTrade.status}
                </span>
              </div>
            </div>
            <Link
              href="/trade-entry"
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400"
            >
              <Zap className="h-3.5 w-3.5" />
              Submit a trade
            </Link>
          </div>
          <StageProgress
            status={latestTrade.status}
            lastSuccessfulStage={latestTrade.last_successful_stage}
            exceptionStage={
              latestTrade.status === "EXCEPTION"
                ? latestTrade.last_successful_stage &&
                    latestTrade.last_successful_stage !== "DONE"
                  ? latestTrade.last_successful_stage
                  : "ONBOARDED"
                : null
            }
          />
        </section>
      )}

      {/* Blotter (full width) */}
      <div className="w-full">
        {loading && trades.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="flex flex-col items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
              Loading blotter…
            </div>
          </div>
        ) : (
          <TradeBlotter trades={trades} highlightTradeId={flashTradeId} />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-full border border-indigo-500/40 bg-slate-900/95 px-4 py-2 text-xs font-medium text-indigo-100 shadow-2xl shadow-black/40 backdrop-blur">
            <Zap className="-mt-0.5 mr-1.5 inline-block h-3.5 w-3.5 text-indigo-300" />
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
  badgeHref,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "indigo" | "sky" | "emerald" | "rose" | "violet" | "cyan" | "slate";
  badgeHref?: string;
}) {
  const tones: Record<string, { bg: string; text: string; border: string; glow: string }> = {
    indigo: { bg: "bg-indigo-500/10", text: "text-indigo-300", border: "border-indigo-500/30", glow: "hover:border-indigo-500/50" },
    sky: { bg: "bg-sky-500/10", text: "text-sky-300", border: "border-sky-500/30", glow: "hover:border-sky-500/50" },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/30", glow: "hover:border-emerald-500/50" },
    rose: { bg: "bg-rose-500/10", text: "text-rose-300", border: "border-rose-500/30", glow: "hover:border-rose-500/50" },
    violet: { bg: "bg-violet-500/10", text: "text-violet-300", border: "border-violet-500/30", glow: "hover:border-violet-500/50" },
    cyan: { bg: "bg-cyan-500/10", text: "text-cyan-300", border: "border-cyan-500/30", glow: "hover:border-cyan-500/50" },
    slate: { bg: "bg-slate-500/10", text: "text-slate-300", border: "border-slate-500/30", glow: "hover:border-slate-500/50" },
  };

  const t = tones[tone];

  const content = (
    <div
      className={clsx(
        "glass-card glass-card-hover flex items-center justify-between rounded-xl px-4 py-3.5 transition-all duration-300",
        t.glow,
      )}
    >
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </div>
        <div className="mt-1 truncate text-xl font-extrabold tabular-nums tracking-tight text-white">
          {value}
        </div>
      </div>
      <div
        className={clsx(
          "flex h-9 w-9 flex-none items-center justify-center rounded-xl border backdrop-blur-md transition-transform duration-300",
          t.bg,
          t.text,
          t.border,
        )}
      >
        {icon}
      </div>
    </div>
  );
  if (badgeHref) {
    return <Link href={badgeHref}>{content}</Link>;
  }
  return content;
}
