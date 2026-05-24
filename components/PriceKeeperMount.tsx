"use client";

import { usePriceKeeper } from "@/lib/hooks/use-price-keeper";

/// Empty render component — its sole job is to mount `usePriceKeeper` once at
/// app start. Place it inside Providers so wagmi context is available.
export function PriceKeeperMount() {
  usePriceKeeper({
    intervalMs: 12_000,
    verbose: process.env.NODE_ENV !== "production",
  });
  return null;
}
