"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

/// Polls /api/defender/status for the given wallet. Returns null when no
/// defender is active. Re-fetches every 15s and exposes `refresh()` for
/// post-mutation refetches.
///
/// The endpoint returns the FULL payload (sessionKey, collateralTokens,
/// installUserOpHash) only when an EIP-712-signed proof of wallet ownership
/// is included. Without the proof the response is the public summary —
/// the hook stores whichever shape comes back. Callers that need sensitive
/// fields can pass `auth` after asking the user to sign once per session.

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

export interface DefenderStatusAuth {
  /// EIP-712 signature over (wallet, exp) by the wallet owner.
  sig: `0x${string}`;
  /// Expiry timestamp (unix seconds) that the signature commits to.
  exp: number;
}

export function useDefenderStatus(
  wallet: Address | undefined,
  auth?: DefenderStatusAuth,
): {
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
      const qs = new URLSearchParams({ wallet });
      if (auth && auth.exp * 1000 > Date.now()) {
        qs.set("sig", auth.sig);
        qs.set("exp", String(auth.exp));
      }
      const res = await fetch(`/api/defender/status?${qs.toString()}`, {
        cache: "no-store",
      });
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
  }, [wallet, auth]);

  useEffect(() => {
    fetchOnce();
    const id = setInterval(fetchOnce, 15_000);
    return () => clearInterval(id);
  }, [fetchOnce]);

  return { status, isLoading, refresh: fetchOnce };
}
