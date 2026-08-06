"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, Filter, RefreshCw } from "lucide-react";
import clsx from "clsx";

import { api } from "@/lib/api";
import type { ExceptionStatus, TradeException } from "@/lib/types";
import ExceptionCard from "@/components/ExceptionCard";

type Tab = ExceptionStatus;

export default function ExceptionsPage() {
  const [tab, setTab] = useState<Tab>("OPEN");
  const [items, setItems] = useState<TradeException[]>([]);
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(
        await api.listExceptions({
          status: tab,
          stage: stageFilter === "ALL" ? undefined : stageFilter,
          limit: 200,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tab, stageFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const stagesPresent = Array.from(
    new Set(items.map((e) => e.stage).filter(Boolean)),
  ).sort();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">Operations &amp; Control</div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <AlertTriangle className="h-7 w-7 text-[#F87171]" />
            Exception Queue
          </h1>
          <p className="mt-1 text-sm text-[#8FA4BD]">
            Ops triage — resolve exceptions and re-run the failed pipeline stage.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#2A2F38] bg-[#191d23] px-3.5 py-1.5 text-xs font-semibold text-[#EFF0F2] hover:bg-[#262D3D] disabled:opacity-50"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </header>

      {/* Tabs + stage filter */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5">
        <div className="inline-flex rounded-lg bg-slate-950 p-0.5 ring-1 ring-inset ring-slate-800">
          {(["OPEN", "RESOLVED"] as Tab[]).map((t) => {
            const count =
              t === tab
                ? items.length
                : t === "OPEN"
                  ? "?"
                  : "?";
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition",
                  tab === t
                    ? t === "OPEN"
                      ? "bg-rose-500/20 text-rose-200 shadow-inner"
                      : "bg-emerald-500/20 text-emerald-200 shadow-inner"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                {t === "OPEN" ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle className="h-3.5 w-3.5" />
                )}
                {t}{" "}
                <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <Filter className="h-3.5 w-3.5" />
          <label className="text-[10px] uppercase tracking-wider text-slate-500">
            Stage:
          </label>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          >
            <option value="ALL">All stages</option>
            {stagesPresent.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-16 text-center text-xs text-slate-500">
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 p-16 text-center">
          {tab === "OPEN" ? (
            <>
              <CheckCircle className="mx-auto mb-3 h-8 w-8 text-emerald-400" />
              <div className="text-sm font-semibold text-slate-200">
                Zero open exceptions — you're all caught up.
              </div>
              <div className="mt-1 text-xs text-slate-500">
                New pipeline breaks will appear here in real time.
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-500">No resolved exceptions yet.</div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {items.map((exc) => (
            <ExceptionCard
              key={exc.id}
              exc={exc}
              onResolved={() => {
                if (tab === "OPEN") {
                  setItems((prev) => prev.filter((x) => x.id !== exc.id));
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
