"use client";

import { useListedAssets, useProtocolStats } from "@/lib/hooks/use-protocol-stats";

/// Single source of truth for the borrow rate shown on the landing page.
/// Reads the live on-chain rate the same way the assets table does, so the
/// page can never show two different numbers for the same vault. Renders "—"
/// while the chain read is in flight. wagmi/react-query dedupes the
/// underlying multicall across consumers.
export function LiveBorrowApr({ suffix = " APR" }: { suffix?: string }) {
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  return (
    <>
      {stats.derived
        ? `${(stats.derived.borrowAprBps / 100).toFixed(2)}%${suffix}`
        : "—"}
    </>
  );
}
