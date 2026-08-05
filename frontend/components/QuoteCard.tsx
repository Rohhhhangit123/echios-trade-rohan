"use client";

import { useEffect, useRef } from "react";
import { createChart, BarSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import clsx from "clsx";
import { useLiveTick } from "@/hooks/useLiveTick";
import { useLiveCandles } from "@/hooks/useLiveCandles";

export interface QuoteCardProps {
  symbol: string;
}

export default function QuoteCard({ symbol }: QuoteCardProps) {
  const { tick } = useLiveTick(symbol);
  const { candles } = useLiveCandles(symbol, 60);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Bar"> | null>(null);

  // Create the chart once per mounted container
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#94a3b8", // slate-400
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.08)" },
        horzLines: { color: "rgba(148,163,184,0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.15)" },
      timeScale: {
        borderColor: "rgba(148,163,184,0.15)",
        timeVisible: true,
        secondsVisible: true,
        barSpacing: 14,
      },
      crosshair: { mode: 0 },
      autoSize: true,
    });

    const series = chart.addSeries(BarSeries, {
      upColor: "#34d399", // emerald-400
      downColor: "#fb7185", // rose-400
      thinBars: false,
      openVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Push candle data whenever the buffer updates
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    const barData = candles.map((c) => ({
      time: (Math.floor(new Date(c.timestamp).getTime() / 1000)) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    seriesRef.current.setData(barData);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  const dayChangePct = (() => {
    if (candles.length < 2 || !tick) return null;
    const first = candles[0].close;
    const pct = ((tick.close - first) / first) * 100;
    return pct;
  })();

  const isUp = (dayChangePct ?? 0) >= 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-100">{symbol} quote</h3>
          <p className="text-xs text-slate-500">Supplied simulation · live</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Last" value={tick ? `$${tick.close.toFixed(2)}` : "—"} bold />
        <Stat
          label="Day"
          value={dayChangePct !== null ? `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%` : "—"}
          tone={dayChangePct === null ? "neutral" : isUp ? "up" : "down"}
        />
        <Stat label="Bid" value={tick ? tick.bid.toFixed(2) : "—"} bold />
        <Stat label="Ask" value={tick ? tick.ask.toFixed(2) : "—"} bold />
      </div>

      <div ref={containerRef} className="h-72 w-full" />
    </div>
  );
}

function Stat({
  label,
  value,
  bold,
  tone = "neutral",
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: "up" | "down" | "neutral";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div
        className={clsx(
          "mt-0.5",
          bold ? "text-lg font-semibold" : "text-sm font-medium",
          tone === "up" && "text-emerald-400",
          tone === "down" && "text-rose-400",
          tone === "neutral" && "text-slate-200",
        )}
      >
        {value}
      </div>
    </div>
  );
}