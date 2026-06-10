"use client";

import { useListedAssets } from "@/lib/hooks/use-protocol-stats";
import { useMarketStatus } from "@/lib/hooks/use-market-status";
import { useStockPrices } from "@/lib/hooks/use-adapter-price";
import { inferMarketOpen } from "@/lib/web3/market-hours";

export interface EquitySession {
  /// true = US equity session open, false = closed, null = unknown (chain
  /// read in flight AND no fresh oracle print to infer from — render nothing
  /// rather than a false "CLOSED").
  open: boolean | null;
  /// Seconds since the newest on-chain Pyth push, null when no on-chain print
  /// has resolved (Hermes-fallback prices carry updatedAt 0 and never count).
  freshnessSec: number | null;
}

/// Session state for the landing surfaces (marquee chip, hero oracle cell).
/// Source of truth is the vault's own `marketStatus` — the exact flag that
/// gates borrows on-chain — with Pyth publish freshness as fallback while the
/// contract read is in flight.
export function useEquitySession(): EquitySession {
  const listed = useListedAssets();
  const { anyClosed, isLoading } = useMarketStatus(listed);
  const prices = useStockPrices();

  const newest = Math.max(
    0,
    ...Object.values(prices).map((p) => p.updatedAt),
  );
  const nowSec = Math.floor(Date.now() / 1000);
  const freshnessSec = newest > 0 ? Math.max(0, nowSec - newest) : null;

  let open: boolean | null = null;
  if (!isLoading && listed.length > 0) {
    open = !anyClosed;
  } else if (newest > 0) {
    open = inferMarketOpen(newest, nowSec);
  }

  return { open, freshnessSec };
}
