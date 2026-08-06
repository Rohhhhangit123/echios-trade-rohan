"use client";

import TradeEntryForm from "@/components/TradeEntryForm";

export default function TradeEntryPage() {
  return (
    <div className="space-y-4">
      <header>
        <div className="eyebrow mb-1">Execution Hub</div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          STP Trade Entry
        </h1>
        <p className="mt-1 text-sm text-[#8FA4BD]">
          Submit structured or natural-language trades — the 11-stage pipeline runs synchronously.
        </p>
      </header>
      <TradeEntryForm modeLabel="STP trade" accentTone="indigo" />
    </div>
  );
}
