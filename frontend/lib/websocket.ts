"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { WsMessage } from "./types";

const WS_URL: string | null =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/trades`
    : null;

export function useTradeWebSocket(onMessage?: (msg: WsMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(() => {
    if (!WS_URL) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (ev) => {
        try {
          const msg: WsMessage = JSON.parse(ev.data);
          setLastMessage(msg);
          onMessage?.(msg);
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        setError("WebSocket error");
      };

      ws.onclose = () => {
        setConnected(false);
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open WebSocket");
    }
  }, [onMessage]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  useEffect(() => {
    connect();
    const retry = setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        connect();
      }
    }, 3000);
    return () => {
      clearInterval(retry);
      disconnect();
    };
  }, [connect, disconnect]);

  return { connected, lastMessage, error, reconnect: connect };
}
