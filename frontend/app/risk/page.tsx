"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowRight,
  Crown,
  Gauge,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Waypoints,
  Zap,
} from "lucide-react";

import { api } from "@/lib/api";
import { useTradeWebSocket } from "@/lib/websocket";
import type { ControlTowerResponse, TradeStatus } from "@/lib/types";
import { STAGE_LABELS } from "@/components/StageProgress";

export default function RiskControlTowerPage() {
  const [tower, setTower] = useState<ControlTowerResponse | null>(null);
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
      setTower(await api.getControlTower());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Headline numbers refresh whenever the pipeline broadcasts a change.
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

  const topStage = tower?.top_failing_stages[0];
  const topClient = tower?.top_failing_clients[0];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">Risk &amp; Compliance</div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <Gauge className="h-7 w-7 text-[#FBBF24]" />
            Risk Control Tower
          </h1>
          <p className="mt-1 text-sm text-[#8FA4BD]">
            Live pipeline health, root-cause breakdown, and every trade currently at risk.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-mono font-semibold",
              connected
                ? "bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30"
                : "bg-[#F59E0B]/15 text-[#FBBF24] border border-[#F59E0B]/30",
            )}
          >
            {connected ? <Zap className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {connected ? "Live" : "Reconnecting…"}
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2A2F38] bg-[#191d23] px-3.5 py-1.5 text-xs font-semibold text-[#EFF0F2] hover:bg-[#262D3D] disabled:opacity-50"
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

      {/* Hero KPIs — the four numbers a risk manager checks first, given real weight */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="STP rate"
          value={tower ? `${tower.stp_rate.toFixed(1)}%` : "—"}
          caption={tower ? `${tower.done_trades} of ${tower.total_trades} trades clean` : undefined}
          good={!!tower && tower.stp_rate >= 90}
          warn={!!tower && tower.stp_rate < 90 && tower.stp_rate >= 70}
          bad={!!tower && tower.stp_rate < 70}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <HeroStat
          label="Open exceptions"
          value={tower ? tower.open_exceptions.toLocaleString() : "—"}
          caption={tower ? `${tower.exception_rate.toFixed(1)}% of all trades` : undefined}
          good={!!tower && tower.open_exceptions === 0}
          warn={!!tower && tower.open_exceptions > 0 && tower.open_exceptions <= 3}
          bad={!!tower && tower.open_exceptions > 3}
          icon={<AlertTriangle className="h-5 w-5" />}
          href="/exceptions"
        />
        <HeroStat
          label="Top-failing stage"
          value={topStage ? STAGE_LABELS[topStage.stage as TradeStatus] ?? topStage.stage : "None"}
          caption={topStage ? `${topStage.count} open exception${topStage.count === 1 ? "" : "s"} here` : "No open exceptions"}
          good={!topStage}
          warn={!!topStage && topStage.count <= 1}
          bad={!!topStage && topStage.count > 1}
          icon={<Waypoints className="h-5 w-5" />}
          isText
        />
        <HeroStat
          label="Highest-risk client"
          value={topClient?.client_name ?? "None flagged"}
          caption={topClient ? `${topClient.count} open exception${topClient.count === 1 ? "" : "s"}` : undefined}
          good={!topClient}
          warn={!!topClient && topClient.count <= 1}
          bad={!!topClient && topClient.count > 1}
          icon={<Crown className="h-5 w-5" />}
          isText
        />
      </div>

      {/* Executive AI summary */}
      <section className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/30 to-slate-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            <div>
              <div className="text-sm font-semibold text-white">Executive daily summary</div>
              <div className="text-xs text-slate-400">AI-generated briefing from today's real numbers</div>
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

      {/* Root cause breakdown — one consistent accent, honest %-of-total scale */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <RootCausePanel
          title="Where trades are breaking"
          subtitle="Open exceptions by pipeline stage"
          empty="No open exceptions right now."
          total={tower?.open_exceptions ?? 0}
          rows={
            tower?.top_failing_stages.map((s) => ({
              key: s.stage,
              label: STAGE_LABELS[s.stage as TradeStatus] ?? s.stage,
              count: s.count,
            })) ?? []
          }
        />
        <RootCausePanel
          title="Who's driving the risk"
          subtitle="Open exceptions by client"
          empty="No open exceptions right now."
          total={tower?.open_exceptions ?? 0}
          rows={
            tower?.top_failing_clients.map((c) => ({
              key: String(c.client_id),
              label: c.client_name ?? `Client ${c.client_id}`,
              count: c.count,
            })) ?? []
          }
        />
      </div>
    </div>
  );
}

function RootCausePanel({
  title,
  subtitle,
  empty,
  total,
  rows,
}: {
  title: string;
  subtitle: string;
  empty: string;
  total: number;
  rows: { key: string; label: string; count: number }[];
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center text-xs text-slate-500">
          {empty}
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((r, idx) => {
            const pct = total > 0 ? (r.count / total) * 100 : 0;
            const isTop = idx === 0;
            return (
              <li
                key={r.key}
                className={clsx(
                  "rounded-lg p-2.5",
                  isTop && "border border-amber-500/30 bg-amber-500/[0.06]",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 truncate font-medium">
                    {isTop && (
                      <span className="flex-none rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                        Top cause
                      </span>
                    )}
                    <span className={clsx("truncate", isTop ? "font-semibold text-amber-100" : "text-slate-300")}>
                      {r.label}
                    </span>
                  </span>
                  <span
                    className={clsx(
                      "flex-none font-semibold tabular-nums",
                      isTop ? "text-amber-200" : "text-slate-200",
                    )}
                  >
                    {r.count} <span className="text-slate-500">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={clsx(
                      "h-full rounded-full",
                      isTop ? "bg-amber-500" : "bg-rose-500/70",
                    )}
                    style={{ width: `${Math.max(pct, 3)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HeroStat({
  label,
  value,
  caption,
  icon,
  good,
  warn,
  bad,
  href,
  isText,
}: {
  label: string;
  value: string;
  caption?: string;
  icon: React.ReactNode;
  good?: boolean;
  warn?: boolean;
  bad?: boolean;
  href?: string;
  isText?: boolean;
}) {
  const tone = bad
    ? "border-rose-500/40 bg-gradient-to-br from-rose-500/10 to-slate-900/60"
    : warn
      ? "border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-slate-900/60"
      : "border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-slate-900/60";
  const valueColor = bad ? "text-rose-300" : warn ? "text-amber-300" : "text-emerald-300";
  const iconTone = bad
    ? "bg-rose-500/15 text-rose-300"
    : warn
      ? "bg-amber-500/15 text-amber-300"
      : "bg-emerald-500/15 text-emerald-300";

  const content = (
    <div className={clsx("rounded-2xl border p-6 transition", tone, href && "hover:brightness-110")}>
      <div className="flex items-start justify-between">
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</div>
        <div className={clsx("flex h-9 w-9 flex-none items-center justify-center rounded-lg", iconTone)}>
          {icon}
        </div>
      </div>
      <div
        className={clsx(
          "mt-2 truncate font-black tracking-tight",
          isText ? "text-2xl" : "text-4xl tabular-nums",
          valueColor,
        )}
        title={value}
      >
        {value}
      </div>
      {caption && <div className="mt-1.5 text-xs text-slate-400">{caption}</div>}
      {href && (
        <div className="mt-3 flex items-center gap-1 text-xs font-medium text-slate-400">
          View exceptions <ArrowRight className="h-3 w-3" />
        </div>
      )}
    </div>
  );
  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}
