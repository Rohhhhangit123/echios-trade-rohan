"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  Building2,
  Coins,
  Crown,
  PieChart as PieChartIcon,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "@/lib/api";
import type { FirmRiskResponse, PortfolioRiskResponse } from "@/lib/types";

const CLIENT_CHOICES: Array<{ id: number; label: string }> = [
  { id: 1, label: "Acme Capital Partners" },
  { id: 2, label: "Globex Asset Management" },
  { id: 4, label: "Umbrella Corp Pension" },
  { id: 5, label: "Stark Industries Treasury" },
];

const PALETTE = [
  "#818cf8",
  "#34d399",
  "#f472b6",
  "#fbbf24",
  "#22d3ee",
  "#fb7185",
  "#a78bfa",
  "#4ade80",
  "#60a5fa",
  "#f97316",
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

function fmtPct(v: string | number, digits = 1): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!isFinite(n)) return String(v);
  return `${n.toFixed(digits)}%`;
}

// HHI on a 0-10,000 scale (sum of squared % weights). <1500 unconcentrated,
// 1500-2500 moderate, >2500 highly concentrated — standard antitrust bands,
// repurposed here as an honest single-number concentration read.
function hhiTone(hhi: number): { label: string; color: string; bg: string; ring: string } {
  if (hhi >= 2500) return { label: "Highly concentrated", color: "text-rose-300", bg: "from-rose-500/10", ring: "ring-rose-500/30" };
  if (hhi >= 1500) return { label: "Moderately concentrated", color: "text-amber-300", bg: "from-amber-500/10", ring: "ring-amber-500/30" };
  return { label: "Well diversified", color: "text-emerald-300", bg: "from-emerald-500/10", ring: "ring-emerald-500/30" };
}

export default function PortfolioRiskPage() {
  const [clientId, setClientId] = useState<number>(CLIENT_CHOICES[0].id);
  const [clientRisk, setClientRisk] = useState<PortfolioRiskResponse | null>(null);
  const [firmRisk, setFirmRisk] = useState<FirmRiskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [client, firm] = await Promise.all([
        api.getPortfolioRisk(clientId),
        api.getFirmRisk(),
      ]);
      setClientRisk(client);
      setFirmRisk(firm);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const holdingsChartData = useMemo(
    () =>
      (clientRisk?.top_holdings ?? []).map((h) => ({
        instrument: h.instrument,
        weight: parseFloat(h.weight_pct) || 0,
        marketValue: parseFloat(h.market_value) || 0,
      })),
    [clientRisk],
  );

  const currencyData = useMemo(() => {
    const entries = Object.entries(clientRisk?.currency_exposure ?? {});
    return entries.map(([ccy, mv]) => ({ name: ccy, value: parseFloat(mv) || 0 }));
  }, [clientRisk]);

  const clientTone = clientRisk ? hhiTone(clientRisk.herfindahl_index) : null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <PieChartIcon className="h-7 w-7 text-violet-400" />
            Portfolio Risk
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Concentration and exposure derived from live positions — no fabricated Beta, VaR, or Sharpe.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-widest text-slate-500">Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(parseInt(e.target.value, 10))}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              {CLIENT_CHOICES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
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

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Data-honesty banner */}
      <div className="flex items-start gap-2.5 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-none text-slate-500" />
        <p>
          Beta, volatility, Sharpe, VaR, drawdown, and correlation metrics are intentionally omitted — this
          platform has no historical price series or benchmark index feed, so those numbers would be fabricated.
          Everything below is computed from real positions and the latest trade price.
        </p>
      </div>

      {/* ---- Client-level section ---- */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
          {clientRisk?.client_name ?? "Client"} — position concentration
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Market value"
            value={clientRisk ? fmtMoney(clientRisk.total_market_value) : "—"}
            icon={<Coins className="h-5 w-5" />}
            tone="slate"
          />
          <StatCard
            label="Top holding weight"
            value={clientRisk ? fmtPct(clientRisk.top1_weight_pct) : "—"}
            caption={clientRisk?.top_holdings[0]?.instrument}
            icon={<Crown className="h-5 w-5" />}
            tone={clientRisk && parseFloat(clientRisk.top1_weight_pct) >= 40 ? "rose" : parseFloat(clientRisk?.top1_weight_pct ?? "0") >= 25 ? "amber" : "emerald"}
          />
          <StatCard
            label="Top 5 weight"
            value={clientRisk ? fmtPct(clientRisk.top5_weight_pct) : "—"}
            icon={<PieChartIcon className="h-5 w-5" />}
            tone={clientRisk && parseFloat(clientRisk.top5_weight_pct) >= 80 ? "rose" : parseFloat(clientRisk?.top5_weight_pct ?? "0") >= 60 ? "amber" : "emerald"}
          />
          <StatCard
            label="Concentration (HHI)"
            value={clientRisk ? clientRisk.herfindahl_index.toLocaleString() : "—"}
            caption={clientTone?.label}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone={clientRisk ? (clientRisk.herfindahl_index >= 2500 ? "rose" : clientRisk.herfindahl_index >= 1500 ? "amber" : "emerald") : "slate"}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 lg:col-span-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-100">Holding weight (% of portfolio)</h3>
            {holdingsChartData.length === 0 ? (
              <EmptyChart text="No positions yet." height={260} />
            ) : (
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={holdingsChartData} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="instrument" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={{ stroke: "#334155" }} tickLine={false} />
                    <YAxis
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      axisLine={{ stroke: "#334155" }}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(129,140,248,0.08)" }}
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12, color: "#e2e8f0" }}
                      formatter={(v: number) => [`${v.toFixed(1)}%`, "Weight"]}
                      labelStyle={{ color: "#cbd5e1", fontWeight: 600 }}
                    />
                    <Bar dataKey="weight" radius={[6, 6, 0, 0]} maxBarSize={40}>
                      {holdingsChartData.map((_, idx) => (
                        <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 lg:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-slate-100">Currency exposure</h3>
            {currencyData.length === 0 ? (
              <EmptyChart text="No exposure yet." height={260} />
            ) : (
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12, color: "#e2e8f0" }}
                      formatter={(v: unknown) => fmtMoney(v as number)}
                    />
                    <Legend verticalAlign="bottom" height={28} iconType="circle" wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                    <Pie data={currencyData} cx="50%" cy="45%" innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke="#020617" strokeWidth={2} dataKey="value">
                      {currencyData.map((_, i) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.9} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Top holdings table */}
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-100">Top holdings</h3>
          </div>
          {(clientRisk?.top_holdings.length ?? 0) === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">No positions for this client.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Instrument</th>
                    <th className="px-4 py-2.5 text-right">Market value</th>
                    <th className="px-4 py-2.5 text-right">Weight</th>
                    <th className="px-4 py-2.5 text-right">Unrealized P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {clientRisk?.top_holdings.map((h) => {
                    const pnl = parseFloat(h.unrealized_pnl) || 0;
                    return (
                      <tr key={h.instrument} className="hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-semibold text-white">{h.instrument}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-200">{fmtMoney(h.market_value)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-200">{fmtPct(h.weight_pct, 1)}</td>
                        <td className={clsx("px-4 py-3 text-right font-semibold tabular-nums", pnl >= 0 ? "text-emerald-300" : "text-rose-300")}>
                          {pnl >= 0 ? "+" : ""}
                          {fmtMoney(pnl)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ---- Firm-wide section ---- */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
          Firm-wide concentration
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total AUM"
            value={firmRisk ? fmtMoney(firmRisk.total_market_value) : "—"}
            icon={<Coins className="h-5 w-5" />}
            tone="slate"
          />
          <StatCard
            label="Clients"
            value={firmRisk ? String(firmRisk.client_count) : "—"}
            icon={<Users className="h-5 w-5" />}
            tone="slate"
          />
          <StatCard
            label="Instruments held"
            value={firmRisk ? String(firmRisk.instrument_count) : "—"}
            icon={<Building2 className="h-5 w-5" />}
            tone="slate"
          />
          <StatCard
            label="Client concentration (HHI)"
            value={firmRisk ? firmRisk.herfindahl_index.toLocaleString() : "—"}
            caption={firmRisk ? hhiTone(firmRisk.herfindahl_index).label : undefined}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone={firmRisk ? (firmRisk.herfindahl_index >= 2500 ? "rose" : firmRisk.herfindahl_index >= 1500 ? "amber" : "emerald") : "slate"}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <RankedPanel
            title="Client concentration"
            subtitle="Share of firm AUM by client"
            rows={
              firmRisk?.client_concentration.map((c) => ({
                key: String(c.client_id),
                label: c.client_name ?? `Client ${c.client_id}`,
                value: parseFloat(c.weight_pct) || 0,
                caption: `${fmtMoney(c.market_value)} · ${c.position_count} position${c.position_count === 1 ? "" : "s"}`,
              })) ?? []
            }
            empty="No positions across clients yet."
          />
          <RankedPanel
            title="Instrument exposure"
            subtitle="Share of firm AUM by instrument, across all clients"
            rows={
              firmRisk?.top_instrument_exposure.map((i) => ({
                key: i.instrument,
                label: i.instrument,
                value: parseFloat(i.weight_pct) || 0,
                caption: `${fmtMoney(i.market_value)} · held by ${i.client_count} client${i.client_count === 1 ? "" : "s"}${i.currency ? ` · ${i.currency}` : ""}`,
              })) ?? []
            }
            empty="No instrument exposure yet."
          />
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  caption,
  icon,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  icon: React.ReactNode;
  tone: "slate" | "emerald" | "amber" | "rose";
}) {
  const tones: Record<string, string> = {
    slate: "border-slate-800 from-slate-800/20 text-slate-200",
    emerald: "border-emerald-500/25 from-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 from-amber-500/10 text-amber-300",
    rose: "border-rose-500/40 from-rose-500/10 text-rose-300",
  };
  const iconTones: Record<string, string> = {
    slate: "bg-slate-500/15 text-slate-300",
    emerald: "bg-emerald-500/15 text-emerald-300",
    amber: "bg-amber-500/15 text-amber-300",
    rose: "bg-rose-500/15 text-rose-300",
  };
  return (
    <div className={clsx("rounded-2xl border bg-gradient-to-br to-slate-900/60 p-5", tones[tone])}>
      <div className="flex items-start justify-between">
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</div>
        <div className={clsx("flex h-9 w-9 flex-none items-center justify-center rounded-lg", iconTones[tone])}>
          {icon}
        </div>
      </div>
      <div className={clsx("mt-2 truncate text-3xl font-black tabular-nums tracking-tight", tones[tone].split(" ")[2])}>
        {value}
      </div>
      {caption && <div className="mt-1.5 truncate text-xs text-slate-400">{caption}</div>}
    </div>
  );
}

function RankedPanel({
  title,
  subtitle,
  rows,
  empty,
}: {
  title: string;
  subtitle: string;
  rows: { key: string; label: string; value: number; caption: string }[];
  empty: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center text-xs text-slate-500">
          {empty}
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {rows.map((r, idx) => (
            <li key={r.key} className="rounded-lg p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-slate-300">{r.label}</span>
                <span className="flex-none font-semibold tabular-nums text-slate-200">{r.value.toFixed(1)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(r.value, 2)}%`, background: PALETTE[idx % PALETTE.length] }}
                />
              </div>
              <div className="mt-1 truncate text-[11px] text-slate-500">{r.caption}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyChart({ height, text }: { height: number; text: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-900/30 text-xs text-slate-500"
      style={{ width: "100%", height }}
    >
      {text}
    </div>
  );
}
