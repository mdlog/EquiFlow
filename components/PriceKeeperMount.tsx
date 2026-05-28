"use client";

import { usePathname } from "next/navigation";
import { usePriceKeeper } from "@/lib/hooks/use-price-keeper";

/// Routes that actually consume live on-chain prices. Landing/docs/governance
/// don't, and there's no reason to ship a 12s server-write loop for every
/// idle pageview. Pyth Hermes prices on `/markets` come from the cached
/// `/api/markets/24h` endpoint, not from the keeper — keeper only matters
/// for routes that read collateral or display per-position health.
const ROUTES_NEEDING_KEEPER: readonly string[] = [
  "/markets",
  "/portfolio",
  "/liquidations",
];

function pathNeedsKeeper(pathname: string | null): boolean {
  if (!pathname) return false;
  return ROUTES_NEEDING_KEEPER.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  );
}

/// Empty render component — its sole job is to mount `usePriceKeeper` once at
/// app start. Gated by route: only the markets/portfolio/liquidations cluster
/// actually consumes live prices, so the keeper stays parked on landing,
/// docs, faucet, etc.
export function PriceKeeperMount() {
  const pathname = usePathname();
  // Hooks cannot be called conditionally, but we can pass a sentinel
  // interval that causes the underlying hook to be a no-op when adapters
  // are empty. Cleanest path: render a dedicated child only when active.
  if (!pathNeedsKeeper(pathname)) return null;
  return <ActiveKeeper />;
}

function ActiveKeeper() {
  usePriceKeeper({
    intervalMs: 12_000,
    verbose: process.env.NODE_ENV !== "production",
  });
  return null;
}
