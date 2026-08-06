"use client";

import TradeEntryForm from "@/components/TradeEntryForm";

export default function TradeEntryPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          STP Trade Entry
        </h1>
        <p className="mt-1 text-sm text-slate-400">

        </p>
      </header>
      <TradeEntryForm modeLabel="STP trade" accentTone="indigo" />
    </div>
  );
}
