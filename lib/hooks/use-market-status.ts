"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { EQUIFLOW_VAULT_ABI, EQUIFLOW_VAULT_ADDRESS } from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { isMarketTradingClosed } from "@/lib/web3/market-hours";

export interface MarketStatusResult {
  /// On-chain status code keyed by lowercased token address; `undefined` while
  /// the read is in flight.
  statusByToken: Record<string, number | undefined>;
  /// Status of the first token queried — convenience for single-asset flows.
  primaryStatus: number | undefined;
  /// True if ANY queried token's market is closed/halted. This mirrors the
  /// vault's `_attributeBorrow`, which reverts if *any* collateral leg backing
  /// the borrow is closed — so a multi-asset position is blocked if even one
  /// leg's market is shut.
  anyClosed: boolean;
  isLoading: boolean;
}

/// Read the vault's on-chain `marketStatus[token]` for one or more collateral
/// tokens, so the UI can gate borrowing *before* the wallet ever tries to
/// estimate gas on a tx that would revert with `MarketClosed`. Pure deposits
/// (`borrowUsd == 0`) are not gated on-chain, so callers should pair this with
/// `isBorrowBlockedByMarket` rather than blocking the whole flow.
export function useMarketStatus(
  tokens: ReadonlyArray<Address | undefined>,
  vaultAddress?: Address,
): MarketStatusResult {
  const addr = (vaultAddress ?? EQUIFLOW_VAULT_ADDRESS) as Address | undefined;
  // Stable, order-preserving key so the memo/query don't churn on the new array
  // identity a caller passes inline each render (e.g. `[tokenAddr]`).
  const keyStr = tokens
    .filter((t): t is Address => !!t)
    .map((t) => t.toLowerCase())
    .join(",");

  const { data, isLoading } = useReadContracts({
    contracts:
      keyStr.length > 0
        ? keyStr.split(",").map((t) => ({
            abi: EQUIFLOW_VAULT_ABI,
            address: addr,
            functionName: "marketStatus" as const,
            args: [t as Address] as const,
            chainId: ROBINHOOD_CHAIN_TESTNET_ID,
          }))
        : [],
    // 30s cadence — the keeper flips status at most a couple times a day; this
    // is only so the banner clears within ~30s of the market reopening without
    // the user refreshing.
    query: { enabled: !!addr && keyStr.length > 0, refetchInterval: 30_000 },
  });

  return useMemo(() => {
    const addrs = keyStr.length > 0 ? keyStr.split(",") : [];
    const statusByToken: Record<string, number | undefined> = {};
    let anyClosed = false;
    addrs.forEach((t, i) => {
      const raw = data?.[i]?.result;
      const status = raw == null ? undefined : Number(raw);
      statusByToken[t] = status;
      if (isMarketTradingClosed(status)) anyClosed = true;
    });
    const primaryStatus = addrs.length > 0 ? statusByToken[addrs[0]] : undefined;
    return { statusByToken, primaryStatus, anyClosed, isLoading };
  }, [data, keyStr, isLoading]);
}
