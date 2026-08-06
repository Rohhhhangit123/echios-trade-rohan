"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, ChevronDown, ChevronUp, PieChart, RefreshCw, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import clsx from "clsx";

import { api } from "@/lib/api";
import type { Position, PortfolioSummary } from "@/lib/types";
import { AllocationDonut, PnLBarChart } from "@/components/charts/PnLCharts";

const CLIENT_CHOICES: Array<{ id: number; label: string }> = [
  { id: 1, label: "Acme Capital Partners" },
  { id: 2, label: "Globex Asset Management" },
  { id: 4, label: "Umbrella Corp Pension" },
  { id: 5, label: "Stark Industries Treasury" },
];

function fmtMoney(v: string | number, digits = 0): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!isFinite(n)) return String(v);
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function fmtNumber(v: string | number, digits = 2): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!isFinite(n)) return String(v);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function PortfolioPage() {
  const [clientId, setClientId] = useState<number>(CLIENT_CHOICES[0].id);
  const [data, setData] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"mv" | "pnl" | "qty">("mv");
  const [expandAll, setExpandAll] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getPortfolio(clientId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const sortedPositions: Position[] = useMemo(() => {
    const rows = data?.positions ?? [];
    const copy = [...rows];
    switch (sortBy) {
      case "mv":
        return copy.sort(
          (a, b) => parseFloat(b.market_value) - parseFloat(a.market_value),
        );
      case "pnl":
        return copy.sort(
          (a, b) =>
            parseFloat(b.unrealized_pnl) - parseFloat(a.unrealized_pnl),
        );
      case "qty":
      default:
        return copy.sort(
          (a, b) => parseFloat(b.quantity) - parseFloat(a.quantity),
        );
    }
  }, [data, sortBy]);

  const pnlPct = parseFloat(data?.total_unrealized_pnl_pct ?? "0");
  const pnlPositive = pnlPct >= 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">Asset Management</div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <Briefcase className="h-7 w-7 text-[#34D399]" />
            Portfolio &amp; P&amp;L
          </h1>
          <p className="mt-1 text-sm text-[#8FA4BD]">
            Live positions, weighted-avg cost basis, and unrealized P&amp;L.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="eyebrow text-[11px]">
              Client
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(parseInt(e.target.value, 10))}
              className="rounded-lg border border-[#2A2F38] bg-[#191d23] px-3.5 py-1.5 text-sm font-mono text-[#EFF0F2] focus:border-[#4FA9E8] focus:outline-none focus:ring-2 focus:ring-[#4FA9E8]/30"
            >
              {CLIENT_CHOICES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <Link
            href="/portfolio/risk"
            className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20"
          >
            <PieChart className="h-3.5 w-3.5" />
            Risk view
          </Link>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </header>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <SummaryCard
            label="Market value"
            value={fmtMoney(data.total_market_value, 0)}
            icon={<Briefcase className="h-4 w-4" />}
            tone="indigo"
          />
          <SummaryCard
            label="Cost basis"
            value={fmtMoney(data.total_cost_basis, 0)}
            icon={<Wallet className="h-4 w-4" />}
            tone="slate"
          />
          <SummaryCard
            label={pnlPositive ? "Unrealized gain" : "Unrealized loss"}
            value={fmtMoney(data.total_unrealized_pnl, 0)}
            sub={`${pnlPositive ? "+" : ""}${fmtNumber(data.total_unrealized_pnl_pct, 2)}%`}
            icon={
              pnlPositive ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )
            }
            tone={pnlPositive ? "emerald" : "rose"}
          />
          <SummaryCard
            label="Nostro balance"
            value={fmtMoney(data.nostro_balance, 0)}
            icon={<Wallet className="h-4 w-4" />}
            tone="violet"
          />
          <SummaryCard
            label="Positions"
            value={String(data.positions.length)}
            icon={<Briefcase className="h-4 w-4" />}
            tone="cyan"
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Unrealized P&L per position</h3>
          </div>
          <PnLBarChart positions={sortedPositions} height={280} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-slate-100">Position allocation</h3>
          <AllocationDonut positions={sortedPositions} height={280} />
        </div>
      </div>

      {/* Positions table */}
      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/60 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">
            Positions{" "}
            <span className="text-slate-500">({sortedPositions.length})</span>
          </h3>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1 text-slate-400">
              Sort:
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="mv">Market value</option>
                <option value="pnl">Unrealized P&L</option>
                <option value="qty">Quantity</option>
              </select>
            </div>
            <button
              onClick={() => setExpandAll((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {expandAll ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {expandAll ? "Collapse" : "Expand"} all
            </button>
          </div>
        </div>

        {loading && sortedPositions.length === 0 ? (
          <div className="p-16 text-center text-xs text-slate-500">Loading…</div>
        ) : sortedPositions.length === 0 ? (
          <div className="p-16 text-center text-xs text-slate-500">
            No positions for this client yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 text-left">Instrument</th>
                  <th className="px-4 py-2.5 text-right">Qty</th>
                  <th className="px-4 py-2.5 text-right">Avg cost</th>
                  <th className="px-4 py-2.5 text-right">Last price</th>
                  <th className="px-4 py-2.5 text-right">Market value</th>
                  <th className="px-4 py-2.5 text-right">Unrealized P&L</th>
                  <th className="px-4 py-2.5 text-right">P&L %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {sortedPositions.map((p) => {
                  const pnl = parseFloat(p.unrealized_pnl) || 0;
                  const up = pnl >= 0;
                  const pnlPctPos =
                    (parseFloat(p.unrealized_pnl_pct) || 0) >= 0;
                  return (
                    <tr
                      key={p.instrument}
                      className="hover:bg-slate-800/30"
                    >
                      <td className="px-4 py-3 font-semibold text-white">
                        {p.instrument}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-200">
                        {fmtNumber(p.quantity, 0)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                        {fmtNumber(p.avg_price, 2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                        {fmtNumber(p.current_price, 2)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-100">
                        {fmtMoney(p.market_value, 0)}
                      </td>
                      <td
                        className={clsx(
                          "px-4 py-3 text-right font-semibold tabular-nums",
                          up ? "text-emerald-300" : "text-rose-300",
                        )}
                      >
                        {up ? "+" : ""}
                        {fmtMoney(p.unrealized_pnl, 0)}
                      </td>
                      <td
                        className={clsx(
                          "px-4 py-3 text-right font-semibold tabular-nums",
                          pnlPctPos ? "text-emerald-300" : "text-rose-300",
                        )}
                      >
                        {pnlPctPos ? "+" : ""}
                        {fmtNumber(p.unrealized_pnl_pct, 2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone: "indigo" | "emerald" | "rose" | "violet" | "cyan" | "slate";
}) {
  const tones: Record<string, string> = {
    indigo: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/30",
    emerald: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
    rose: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
    violet: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
    cyan: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/30",
    slate: "bg-slate-500/10 text-slate-300 ring-slate-500/30",
  };
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          {label}
        </div>
        <div className="mt-1 truncate text-xl font-bold tabular-nums text-white">
          {value}
        </div>
        {sub && (
          <div
            className={clsx(
              "mt-0.5 text-xs font-semibold tabular-nums",
              tone === "emerald" && "text-emerald-300",
              tone === "rose" && "text-rose-300",
              tone !== "emerald" && tone !== "rose" && "text-slate-400",
            )}
          >
            {sub}
          </div>
        )}
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
}
