"use client";

import { useMemo } from "react";
import type { Position } from "@/lib/types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Legend,
} from "recharts";
import clsx from "clsx";

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

function fmtMoney(v: number | string, digits = 0) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!isFinite(n)) return String(v);
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

interface PnLBarChartProps {
  positions: Position[];
  height?: number;
}

export function PnLBarChart({ positions, height = 280 }: PnLBarChartProps) {
  const data = useMemo(
    () =>
      positions
        .map((p) => ({
          instrument: p.instrument,
          PnL: parseFloat(p.unrealized_pnl) || 0,
          positive: (parseFloat(p.unrealized_pnl) || 0) >= 0,
          marketValue: parseFloat(p.market_value) || 0,
        }))
        .sort((a, b) => b.marketValue - a.marketValue),
    [positions],
  );

  if (data.length === 0) {
    return (
      <EmptyChart
        height={height}
        text="No positions yet — P&L will appear here after settlement."
      />
    );
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="instrument"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={{ stroke: "#334155" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={{ stroke: "#334155" }}
            tickLine={false}
            tickFormatter={(v) =>
              Math.abs(v) >= 1e6
                ? `${(v / 1e6).toFixed(1)}M`
                : Math.abs(v) >= 1e3
                  ? `${(v / 1e3).toFixed(0)}k`
                  : `${v}`
            }
          />
          <Tooltip
            cursor={{ fill: "rgba(99,102,241,0.08)" }}
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 8,
              fontSize: 12,
              color: "#e2e8f0",
            }}
            formatter={(v: number) => [fmtMoney(v, 0), "Unrealized P&L"]}
            labelStyle={{ color: "#cbd5e1", fontWeight: 600 }}
          />
          <Bar dataKey="PnL" radius={[6, 6, 0, 0]} maxBarSize={36}>
            {data.map((entry, idx) => (
              <Cell
                key={idx}
                fill={entry.positive ? "#10b981" : "#f43f5e"}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface AllocationDonutProps {
  positions: Position[];
  height?: number;
}

export function AllocationDonut({
  positions,
  height = 280,
}: AllocationDonutProps) {
  const data = useMemo(() => {
    const withMv = positions
      .map((p) => ({
        name: p.instrument,
        value: parseFloat(p.market_value) || 0,
      }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = withMv.reduce((s, r) => s + r.value, 0);
    return { rows: withMv, total };
  }, [positions]);

  if (data.rows.length === 0) {
    return (
      <EmptyChart
        height={height}
        text="No market value to allocate — fund and settle positions first."
      />
    );
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 8,
              fontSize: 12,
              color: "#e2e8f0",
            }}
            formatter={(v: unknown, n: unknown, entry: unknown) => {
              const name =
                (entry as { payload?: { name?: string } })?.payload?.name ??
                (typeof n === "string" ? n : "");
              const num = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
              return [
                `${fmtMoney(num, 0)} (${((num / data.total) * 100).toFixed(1)}%)`,
                name,
              ];
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={32}
            iconType="circle"
            wrapperStyle={{ fontSize: 11, color: "#94a3b8" }}
          />
          <Pie
            data={data.rows}
            cx="50%"
            cy="45%"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={1.5}
            stroke="#020617"
            strokeWidth={2}
            dataKey="value"
          >
            {data.rows.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.9} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyChart({ height, text }: { height: number; text: string }) {
  return (
    <div
      className={clsx(
        "flex items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-900/30 text-xs text-slate-500",
      )}
      style={{ width: "100%", height }}
    >
      {text}
    </div>
  );
}
