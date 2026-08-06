"use client";

import { Sparkles, Wallet } from "lucide-react";
import TradeEntryForm from "@/components/TradeEntryForm";
import { api } from "@/lib/api";
import type { Trade } from "@/lib/types";

export default function PaperTradingPage() {
  return (
    <div className="space-y-4">
      <div className="card-gradient-blue-violet flex flex-wrap items-center gap-3 p-4">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-[#8B6EE0]/20 text-[#C9B8F5] border border-[#8B6EE0]/30">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            <Wallet className="h-5 w-5 text-[#8B6EE0]" />
            Paper Trading Environment
          </h2>
          <p className="mt-0.5 text-xs text-[#8FA4BD]">
            Same 11-stage pipeline, but <span className="font-mono font-semibold text-[#C9B8F5]">simulated=True</span> — test trades without ledger impact.
          </p>
        </div>
      </div>

      <TradeEntryForm
        modeLabel="paper trade"
        accentTone="violet"
        submitFn={async (body) => (await api.createPaperTrade(body)) as Trade}
      />
    </div>
  );
}
