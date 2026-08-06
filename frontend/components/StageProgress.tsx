"use client";

import clsx from "clsx";
import { AlertTriangle, Check, Circle, Dot } from "lucide-react";
import { STAGE_ORDER, type TradeStatus } from "@/lib/types";

const STAGE_LABELS: Record<TradeStatus, string> = {
  ONBOARDED: "Onboarded",
  EXECUTED: "Executed",
  CAPTURED: "Captured",
  ENRICHED: "Enriched",
  ALLOCATED: "Allocated",
  VALIDATED: "Validated",
  CONFIRMED: "Confirmed",
  FUNDED: "Funded",
  SETTLED: "Settled",
  RECONCILED: "Reconciled",
  DONE: "Done",
  EXCEPTION: "Exception",
};

interface StageProgressProps {
  status: TradeStatus;
  lastSuccessfulStage: TradeStatus | null;
  exceptionStage?: TradeStatus | null;
  size?: "sm" | "md";
}

export default function StageProgress({
  status,
  lastSuccessfulStage,
  exceptionStage,
  size = "md",
}: StageProgressProps) {
  const currentIdx = STAGE_ORDER.indexOf(status);
  const lastOkIdx = lastSuccessfulStage
    ? STAGE_ORDER.indexOf(lastSuccessfulStage)
    : -1;

  const effCurrentIdx =
    status === "EXCEPTION"
      ? exceptionStage
        ? STAGE_ORDER.indexOf(exceptionStage)
        : Math.max(0, lastOkIdx + 1)
      : currentIdx;

  const excStageIdx = exceptionStage ? STAGE_ORDER.indexOf(exceptionStage) : -1;
  const isException = status === "EXCEPTION";

  const spacing = size === "sm" ? "gap-1" : "gap-2";
  const nodeSize = size === "sm" ? "h-5 w-5 min-w-5 min-h-5" : "h-8 w-8 min-w-8 min-h-8";
  const textSize = size === "sm" ? "text-[9px]" : "text-[11px]";

  return (
    <div className="w-full">
      <div className={clsx("relative flex items-stretch justify-between", spacing)}>
        {STAGE_ORDER.map((stage, idx) => {
          const label = STAGE_LABELS[stage];
          const isCompleted = idx < effCurrentIdx || (isException && idx <= lastOkIdx);
          const isCurrent = idx === effCurrentIdx && !isException;
          const isExceptionHere = isException && idx === excStageIdx;

          return (
            <div key={stage} className="relative flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center justify-center">
                {idx > 0 && (
                  <div
                    className={clsx(
                      "mr-1 h-0.5 flex-1 rounded-full transition-colors",
                      idx <= lastOkIdx || (idx <= effCurrentIdx && !isException)
                        ? "bg-emerald-500/70"
                        : "bg-slate-700/60",
                    )}
                  />
                )}
                <div
                  className={clsx(
                    "relative z-10 flex items-center justify-center rounded-full border transition-all duration-300",
                    nodeSize,
                    isCompleted &&
                      !isExceptionHere &&
                      "border-emerald-500/80 bg-emerald-500/20 text-emerald-300 glow-emerald",
                    isCurrent &&
                      !isExceptionHere &&
                      "border-indigo-400 bg-indigo-500/25 text-indigo-200 glow-indigo animate-pulse-soft ring-4 ring-indigo-500/20",
                    !isCompleted &&
                      !isCurrent &&
                      !isExceptionHere &&
                      "border-slate-800 bg-slate-900/80 text-slate-600",
                    isExceptionHere &&
                      "border-rose-500/90 bg-rose-500/25 text-rose-300 glow-rose ring-4 ring-rose-500/20",
                  )}
                  title={label}
                >
                  {isCompleted && !isExceptionHere ? (
                    <Check className={size === "sm" ? "h-3 w-3 stroke-[2.5]" : "h-4 w-4 stroke-[2.5]"} />
                  ) : isExceptionHere ? (
                    <AlertTriangle className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />
                  ) : isCurrent ? (
                    <Dot className={size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5"} />
                  ) : (
                    <Circle className={size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"} />
                  )}
                </div>
                {idx < STAGE_ORDER.length - 1 && (
                  <div
                    className={clsx(
                      "ml-1 h-0.5 flex-1 rounded-full transition-colors",
                      idx < lastOkIdx
                        ? "bg-emerald-500/70"
                        : "bg-slate-700/60",
                    )}
                  />
                )}
              </div>

              <div
                className={clsx(
                  "mt-1 w-full truncate text-center font-medium tracking-tight",
                  textSize,
                  isCompleted && !isExceptionHere ? "text-emerald-300" : "text-slate-500",
                  isCurrent && !isExceptionHere && "text-indigo-300",
                  isExceptionHere && "text-rose-300",
                )}
              >
                {label}
              </div>

              {isExceptionHere && (
                <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-6 -translate-x-1/2 whitespace-nowrap rounded-md border border-rose-500/50 bg-rose-950/90 px-2 py-1 text-[10px] font-medium text-rose-200 shadow-lg">
                  <span className="mr-1">⚠</span> Exception at this stage
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { STAGE_LABELS };
