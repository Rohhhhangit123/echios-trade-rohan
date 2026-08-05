"use client";

import { useState } from "react";
import QuoteCard from "@/components/QuoteCard";

const INSTRUMENT_CHOICES = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META",
  "TCS", "RELIANCE", "VOD", "BP",
];

export default function ChartsPage() {
  const [symbol, setSymbol] = useState("AAPL");

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Live charts</h1>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        >
          {INSTRUMENT_CHOICES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <QuoteCard symbol={symbol} />
    </div>
  );
}