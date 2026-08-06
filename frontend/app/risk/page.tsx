"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  AlertTriangle,
  Gauge,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import { api } from "@/lib/api";
import { useTradeWebSocket } from "@/lib/websocket";
import type { ControlTowerResponse, LiveTradeSummary, TradeStatus } from "@/lib/types";
import { STAGE_LABELS } from "@/components/StageProgress";

export default function RiskControlTowerPage() {
  const [tower, setTower] = useState<ControlTowerResponse | null>(null);
  const [liveTrades, setLiveTrades] = useState<LiveTradeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const { connected, lastMessage } = useTradeWebSocket();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, lt] = await Promise.all([
        api.getControlTower(),
        api.getLiveTrades(60),
      ]);
      setTower(t);
      setLiveTrades(lt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live grid + headline numbers refresh whenever the pipeline broadcasts a change.
  useEffect(() => {
    if (!lastMessage) return;
    if (
      lastMessage.type === "trade_updated" ||
      lastMessage.type === "exception_created" ||
      lastMessage.type === "exception_resolved"
    ) {
      refresh();
    }
  }, [lastMessage, refresh]);

  const generateSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const resp = await api.genaiRiskDailySummary();
      setSummary(resp.narrative);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : String(e));
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const exceptionsTrend = useMemo(() => {
    if (!tower) return null;
    const { exceptions_today, exceptions_yesterday } = tower;
    if (exceptions_yesterday === 0) return null;
    const pct = ((exceptions_today - exceptions_yesterday) / exceptions_yesterday) * 100;
    return pct;
  }, [tower]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <Gauge className="h-7 w-7 text-amber-400" />
            Risk Control Tower
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Live pipeline health, root-cause breakdown, and every trade currently at risk.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
              connected
                ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
                : "bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/30",
            )}
          >
            {connected ? <Zap className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            WebSocket {connected ? "LIVE" : "reconnecting…"}
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Control Tower stat grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="STP rate"
          value={tower ? `${tower.stp_rate.toFixed(1)}%` : "—"}
          icon={<TrendingUp className="h-4 w-4" />}
          tone={tower && tower.stp_rate >= 90 ? "emerald" : tower && tower.stp_rate >= 70 ? "amber" : "rose"}
        />
        <StatCard
          label="Open exceptions"
          value={tower ? tower.open_exceptions.toLocaleString() : "—"}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={tower && tower.open_exceptions > 0 ? "rose" : "slate"}
          href="/exceptions"
        />
        <StatCard
          label="Exception rate"
          value={tower ? `${tower.exception_rate.toFixed(1)}%` : "—"}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={tower && tower.exception_rate > 20 ? "rose" : "amber"}
        />
        <StatCard
          label="Avg resolution"
          value={tower ? `${tower.avg_resolution_minutes.toFixed(1)}m` : "—"}
          icon={<Gauge className="h-4 w-4" />}
          tone="sky"
        />
        <StatCard
          label="Exceptions today"
          value={tower ? tower.exceptions_today.toLocaleString() : "—"}
          icon={
            exceptionsTrend !== null && exceptionsTrend > 0 ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )
          }
          tone={
            exceptionsTrend === null
              ? "slate"
              : exceptionsTrend > 0
                ? "rose"
                : "emerald"
          }
          sub={
            exceptionsTrend !== null
              ? `${exceptionsTrend > 0 ? "+" : ""}${exceptionsTrend.toFixed(0)}% vs yesterday`
              : undefined
          }
        />
        <StatCard
          label="Top-risk client"
          value={tower?.top_failing_clients[0]?.client_name ?? "—"}
          icon={<Users className="h-4 w-4" />}
          tone="violet"
          small
        />
      </div>

      {/* Executive AI summary */}
      <section className="rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/30 to-slate-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            <div>
              <div className="text-sm font-semibold text-white">Executive daily summary</div>
              <div className="text-xs text-slate-400">AI-generated briefing from today's real numbers above</div>
            </div>
          </div>
          <button
            onClick={generateSummary}
            disabled={summaryLoading || !tower}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {summaryLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {summary ? "Regenerate" : "Generate summary"}
          </button>
        </div>
        {summaryError && (
          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {summaryError}
          </div>
        )}
        {summary && (
          <p className="mt-4 whitespace-pre-line rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm leading-relaxed text-slate-200">
            {summary}
          </p>
        )}
      </section>

      {/* Root cause breakdown */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-100">
            Root cause — open exceptions by stage
          </h2>
          {!tower || tower.top_failing_stages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center text-xs text-slate-500">
              No open exceptions right now.
            </div>
          ) : (
            <ul className="space-y-2">
              {tower.top_failing_stages.map((s) => {
                const max = tower.top_failing_stages[0].count || 1;
                const pct = Math.max(6, (s.count / max) * 100);
                return (
                  <li key={s.stage} className="flex items-center gap-3">
                    <span className="w-28 flex-none truncate text-xs font-medium text-slate-300">
                      {STAGE_LABELS[s.stage as TradeStatus] ?? s.stage}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-6 flex-none text-right text-xs font-semibold tabular-nums text-slate-200">
                      {s.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-100">
            Root cause — open exceptions by client
          </h2>
          {!tower || tower.top_failing_clients.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center text-xs text-slate-500">
              No open exceptions right now.
            </div>
          ) : (
            <ul className="space-y-2">
              {tower.top_failing_clients.map((c) => {
                const max = tower.top_failing_clients[0].count || 1;
                const pct = Math.max(6, (c.count / max) * 100);
                return (
                  <li key={c.client_id} className="flex items-center gap-3">
                    <span className="w-28 flex-none truncate text-xs font-medium text-slate-300">
                      {c.client_name ?? `Client ${c.client_id}`}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-6 flex-none text-right text-xs font-semibold tabular-nums text-slate-200">
                      {c.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Digital Twin — live grid of at-risk / in-flight trades */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Zap className="h-4 w-4 text-indigo-400" />
            Live floor — trades in flight or in exception
            <span className="text-slate-500">({liveTrades.length})</span>
          </h2>
          <Link href="/exceptions" className="text-xs text-indigo-300 hover:text-indigo-200">
            Full exception queue →
          </Link>
        </div>

        {loading && liveTrades.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
          </div>
        ) : liveTrades.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 p-10 text-center text-xs text-slate-500">
            No trades currently in flight — everything is DONE.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {liveTrades.map((t) => (
              <LiveTradeTile key={t.id} trade={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LiveTradeTile({ trade }: { trade: LiveTradeSummary }) {
  const isException = trade.status === "EXCEPTION";
  return (
    <div
      className={clsx(
        "rounded-lg border p-3 transition",
        isException
          ? "border-rose-500/40 bg-rose-500/5"
          : "border-slate-800 bg-slate-900/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-slate-500">#{trade.id}</span>
        <span
          className={clsx(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            isException
              ? "bg-rose-500/20 text-rose-200"
              : "bg-indigo-500/15 text-indigo-200",
          )}
        >
          {isException
            ? `EXC @ ${trade.exception_stage ?? "?"}`
            : trade.status}
        </span>
      </div>
      <div className="mt-1.5 truncate text-sm font-semibold text-white">
        {trade.instrument}
      </div>
      <div className="truncate text-xs text-slate-400">
        {trade.client_name ?? "Unknown client"}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
  href,
  sub,
  small,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "indigo" | "sky" | "emerald" | "rose" | "violet" | "cyan" | "amber" | "slate";
  href?: string;
  sub?: string;
  small?: boolean;
}) {
  const tones: Record<string, string> = {
    indigo: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/30",
    sky: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
    emerald: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
    rose: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
    violet: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
    cyan: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/30",
    amber: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
    slate: "bg-slate-500/10 text-slate-300 ring-slate-500/30",
  };
  const content = (
    <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 transition hover:bg-slate-900/80">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          {label}
        </div>
        <div
          className={clsx(
            "mt-1 truncate font-bold tabular-nums text-white",
            small ? "text-sm" : "text-xl",
          )}
        >
          {value}
        </div>
        {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
      </div>
      <div
        className={clsx(
          "flex h-9 w-9 flex-none items-center justify-center rounded-lg ring-1 ring-inset",
          tones[tone],
        )}
      >
        {icon}
      </div>
    </div>
  );
  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}
