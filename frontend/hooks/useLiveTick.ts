"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Tick } from "@/lib/types";

const POLL_INTERVAL_MS = 1000;

export function useLiveTick(symbol: string) {
  const [tick, setTick] = useState<Tick | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const fetchTick = async () => {
      try {
        const next = await api.getTick(symbol);
        if (cancelled) return;
        setTick(next);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        // Keep last-known tick on screen; just record the error.
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchTick();
    const intervalId = setInterval(fetchTick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [symbol]);

  return { tick, loading, error };
}