"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

/// Polls /api/defender/status for the given wallet. Returns null when no
/// defender is active. Re-fetches every 15s and exposes `refresh()` for
/// post-mutation refetches.

export interface DefenderStatus {
  enabled: boolean;
  wallet?: Address;
  sessionKey?: Address;
  threshold?: string; // 1e18-scaled bigint as decimal string
  weeklyLimit?: string; // USDG atomic (6dec)
  weekUsed?: string;
  weekStart?: number;
  expiresAt?: number;
  collateralTokens?: string[];
  installUserOpHash?: string | null;
}

export function useDefenderStatus(wallet: Address | undefined): {
  status: DefenderStatus | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<DefenderStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchOnce = useCallback(async () => {
    if (!wallet) {
      setStatus(null);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/defender/status?wallet=${wallet}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setStatus(null);
        return;
      }
      const json = (await res.json()) as DefenderStatus;
      setStatus(json);
    } catch {
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    fetchOnce();
    const id = setInterval(fetchOnce, 15_000);
    return () => clearInterval(id);
  }, [fetchOnce]);

  return { status, isLoading, refresh: fetchOnce };
}
