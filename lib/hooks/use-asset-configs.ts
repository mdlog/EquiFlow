"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import {
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { STOCKS } from "@/lib/config/stocks";

/// Read on-chain asset configuration for every catalogue symbol.
///
/// Returns Map<sym, { ltvBps, liqThresholdBps, staleAfter, enabled, adapter }>
/// using vault.assets(token). For symbols without an on-chain token,
/// fallback to static STOCKS catalogue ltv (×10000) with `onChain: false`.

export interface AssetConfig {
  /** Max LTV in basis points (e.g. 7500 = 75%). */
  ltvBps: number;
  /** Liquidation threshold in bps. */
  liqThresholdBps: number;
  /** Price feed adapter address. */
  adapter: Address | null;
  /** Asset enabled in vault. */
  enabled: boolean;
  /** Stale price window in seconds. */
  staleAfter: number;
  /** True if this row came from chain (not catalogue fallback). */
  onChain: boolean;
}

export function useAssetConfigsMap(): Map<string, AssetConfig> {
  const vault = EQUIFLOW_VAULT_ADDRESS;

  const liveSymbols = useMemo(
    () => STOCKS.filter((s) => !!STOCK_TOKEN_ADDRESSES[s.sym]),
    [],
  );

  const { data: reads } = useReadContracts({
    allowFailure: true,
    contracts: liveSymbols.map((s) => ({
      abi: EQUIFLOW_VAULT_ABI,
      address: vault,
      functionName: "assets" as const,
      args: [STOCK_TOKEN_ADDRESSES[s.sym]!] as const,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    })),
    query: {
      enabled: !!vault && liveSymbols.length > 0,
      staleTime: Infinity,
    },
  });

  return useMemo(() => {
    const map = new Map<string, AssetConfig>();

    // Fallback rows for every catalogue symbol.
    for (const s of STOCKS) {
      map.set(s.sym, {
        ltvBps: Math.round(s.ltv * 10_000),
        liqThresholdBps: Math.round(s.ltv * 10_000) + 800,
        adapter: null,
        enabled: false,
        staleAfter: 3600,
        onChain: false,
      });
    }

    if (!reads) return map;

    liveSymbols.forEach((s, i) => {
      const r = reads[i];
      if (!r || r.status !== "success") return;
      const [adapter, ltvBps, liqThresholdBps, staleAfter, enabled] =
        r.result as readonly [Address, bigint, bigint, bigint, boolean];
      map.set(s.sym, {
        adapter,
        ltvBps: Number(ltvBps),
        liqThresholdBps: Number(liqThresholdBps),
        staleAfter: Number(staleAfter),
        enabled,
        onChain: true,
      });
    });

    return map;
  }, [reads, liveSymbols]);
}
