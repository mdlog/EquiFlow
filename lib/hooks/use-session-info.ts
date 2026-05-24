"use client";

import { useEffect, useState } from "react";

/// Active Pyth session for a US equity. Pyth Network publishes 4 separate
/// feeds per ticker; only one is "active" (freshest publishTime) at any moment.
export type PythSession = "regular" | "pre" | "post" | "overnight";

export interface SessionInfo {
  session: PythSession | null;
  publishTime: number; // unix seconds, 0 = unknown
  /** Hermes-reported price for the active session (decimal USD). */
  price: number | null;
  isLoading: boolean;
  error: string | null;
}

const POLL_MS = 30_000;

/// Fetches the freshest Pyth session for `symbol` from /api/pyth/by-symbol/.
/// Refreshes every 30s. Returns null fields while loading or on error so
/// UI can fall back gracefully (showing on-chain price + neutral badge).
export function useSessionInfo(symbol: string): SessionInfo {
  const [state, setState] = useState<SessionInfo>({
    session: null,
    publishTime: 0,
    price: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/pyth/by-symbol/${symbol}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) {
            setState((s) => ({
              ...s,
              isLoading: false,
              error: `http_${res.status}`,
            }));
          }
        } else {
          const data = (await res.json()) as {
            activeSession: PythSession;
            price: string;
            expo: number;
            publishTime: number;
          };
          if (!cancelled) {
            const decimal = Number(data.price) * Math.pow(10, data.expo);
            setState({
              session: data.activeSession,
              publishTime: data.publishTime,
              price: decimal > 0 ? decimal : null,
              isLoading: false,
              error: null,
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            isLoading: false,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [symbol]);

  return state;
}
