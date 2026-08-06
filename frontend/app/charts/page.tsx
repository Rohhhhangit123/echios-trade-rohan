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
        <div>
          <div className="eyebrow mb-1">Market Analytics</div>
          <h1 className="text-xl font-bold text-white">Live Charts</h1>
        </div>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded-lg border border-[#2A2F38] bg-[#191d23] px-3.5 py-2 text-sm font-mono text-[#EFF0F2] focus:border-[#4FA9E8] focus:outline-none focus:ring-2 focus:ring-[#4FA9E8]/30"
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