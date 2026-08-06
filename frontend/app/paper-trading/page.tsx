"use client";

import { Sparkles, Wallet } from "lucide-react";
import TradeEntryForm from "@/components/TradeEntryForm";
import { api } from "@/lib/api";
import type { Trade } from "@/lib/types";

export default function PaperTradingPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-500/30 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/5 to-indigo-500/10 p-4 ring-1 ring-inset ring-violet-500/20">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-violet-500/20 text-violet-300 ring-1 ring-inset ring-violet-500/30">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            <Wallet className="h-5 w-5 text-violet-300" />
            Paper trading environment
          </h2>
          <p className="mt-0.5 text-xs text-slate-300/90">
     
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
