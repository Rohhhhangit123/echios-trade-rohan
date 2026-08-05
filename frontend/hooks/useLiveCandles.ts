"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Tick } from "@/lib/types";

const POLL_INTERVAL_MS = 1000;
const MAX_BUFFER = 80;

export function useLiveCandles(symbol: string, backfillCount = 200) {
  const [candles, setCandles] = useState<Tick[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastTimestampRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    lastTimestampRef.current = null;

    const backfill = async () => {
      try {
        const res = await api.getCandles(symbol, backfillCount);
        if (cancelled) return;
        setCandles(res.candles);
        lastTimestampRef.current =
          res.candles.length > 0
            ? res.candles[res.candles.length - 1].timestamp
            : null;
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const pollNext = async () => {
      try {
        const tick = await api.getTick(symbol);
        if (cancelled) return;
        // Only append if this is genuinely a new candle (timestamp advanced)
        if (tick.timestamp !== lastTimestampRef.current) {
          lastTimestampRef.current = tick.timestamp;
          setCandles((prev) => {
            const next = [...prev, tick];
            return next.length > MAX_BUFFER
              ? next.slice(next.length - MAX_BUFFER)
              : next;
          });
        }
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    backfill();
    const intervalId = setInterval(pollNext, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [symbol, backfillCount]);

  return { candles, loading, error };
}