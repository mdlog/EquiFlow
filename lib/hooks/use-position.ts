"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import {
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { STOCKS, findStock } from "@/lib/config/stocks";
import { useStockPrices } from "@/lib/hooks/use-adapter-price";
import { useActiveWallet } from "@/lib/hooks/use-active-wallet";

export type LiveCollateralLine = {
  sym: string;
  shares: number;
  /// Exact on-chain collateral balance, in raw token units. Modals use this
  /// when the user maxes out a withdraw — `parseUnits(shares.toFixed(...))`
  /// drifts by up to a few wei due to JS float, which the vault rejects with
  /// `InsufficientCollateral()`. Passing this raw bigint avoids the drift.
  sharesRaw: bigint;
  value: number; // USD (decimal)
  weight: number; // 0..1
};

export type LivePosition = {
  connected: boolean;
  vaultConfigured: boolean;
  hasPosition: boolean;
  collateralUsd: number;
  borrowedUsd: number;
  healthFactor: number; // 1e18-scaled → decimal
  /** Blended liquidation threshold in percentage points (e.g. 80 = 80%).
   *  Read from vault.liquidationThresholdBps(user). Null while loading. */
  liqThresholdPct: number | null;
  lines: LiveCollateralLine[];
  loading: boolean;
  /** True when positionOf() reverts with StalePrice — collateralUsd/borrowedUsd
   *  are unreliable and on-chain actions (borrow/withdraw/repay) will revert
   *  until the keeper ticks fresh Pyth prices. Drives the stale-oracle banner. */
  oracleStale: boolean;
};

/// Pyth adapter custom error selector for `StalePrice()`. The vault's
/// `_price()` reverts with this when adapter `updatedAt + staleAfter < now`.
const STALE_PRICE_SELECTOR = "0x19abf40e";

const EMPTY: LivePosition = {
  connected: false,
  vaultConfigured: false,
  hasPosition: false,
  collateralUsd: 0,
  borrowedUsd: 0,
  healthFactor: Number.POSITIVE_INFINITY,
  liqThresholdPct: null,
  lines: [],
  loading: false,
  oracleStale: false,
};

export function usePosition(): LivePosition {
  // Use the ACTIVE wallet (smart account when in AA mode) — vault state is
  // keyed by the address that actually calls `pledgeAndBorrow`, which is the
  // smart account when sponsored gas / 7702 mode is on.
  const { address, isConnected } = useActiveWallet();
  const vault = EQUIFLOW_VAULT_ADDRESS;
  const vaultConfigured = !!vault;
  const livePrices = useStockPrices();

  const {
    data: positionRaw,
    error: positionError,
    isLoading: posLoading,
  } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vault,
    functionName: "positionOf",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: {
      enabled: !!vault && !!address,
      refetchInterval: 12_000,
      // Don't keep retrying a revert — the underlying cause (stale oracle) is
      // resolved by the keeper, not by re-querying. Retries just spam the RPC.
      retry: false,
    },
  });

  // Detect StalePrice revert. Wagmi/viem put the raw revert data in
  // `error.cause.data` or `error.message`; we sniff both for robustness.
  const oracleStale = useMemo(() => {
    if (!positionError) return false;
    const msg = positionError.message ?? "";
    if (msg.toLowerCase().includes(STALE_PRICE_SELECTOR)) return true;
    if (msg.includes("StalePrice")) return true;
    // viem ContractFunctionRevertedError exposes the selector on `.data.errorName`
    const cause = (positionError as unknown as { cause?: { data?: { errorName?: string } } })
      .cause;
    if (cause?.data?.errorName === "StalePrice") return true;
    return false;
  }, [positionError]);

  const { data: liqThresholdRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vault,
    functionName: "liquidationThresholdBps",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: {
      enabled: !!vault && !!address,
      refetchInterval: 30_000,
    },
  });
  const liqThresholdPct =
    liqThresholdRaw != null ? Number(liqThresholdRaw as bigint) / 100 : null;

  // For each configured stock token, ask the vault how much collateral this user has
  const tokenList = useMemo(
    () =>
      STOCKS.map((s) => ({ sym: s.sym, addr: STOCK_TOKEN_ADDRESSES[s.sym] }))
        .filter((x): x is { sym: string; addr: `0x${string}` } => !!x.addr),
    [],
  );

  const { data: collateralRaw, isLoading: collLoading } = useReadContracts({
    allowFailure: true,
    contracts: tokenList.map((t) => ({
      abi: EQUIFLOW_VAULT_ABI,
      address: vault,
      functionName: "collateral" as const,
      args: address ? ([address, t.addr] as const) : undefined,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    })),
    query: {
      enabled: !!vault && !!address && tokenList.length > 0,
      refetchInterval: 15_000,
    },
  });

  return useMemo<LivePosition>(() => {
    if (!isConnected) {
      return { ...EMPTY, connected: false, vaultConfigured };
    }
    if (!vaultConfigured) {
      return { ...EMPTY, connected: true, vaultConfigured: false };
    }
    const loading = posLoading || collLoading;
    const [collUsdRaw, borrowedRaw, healthRaw] = (positionRaw as
      | readonly [bigint, bigint, bigint]
      | undefined) ?? [0n, 0n, 0n];

    const collateralUsd = Number(formatUnits(collUsdRaw, 18));
    const borrowedUsd = Number(formatUnits(borrowedRaw, 18));
    const healthFactor =
      healthRaw === undefined || healthRaw === 0n
        ? Number.POSITIVE_INFINITY
        : Number(formatUnits(healthRaw, 18));

    // Build per-asset breakdown
    const lines: LiveCollateralLine[] = [];
    if (collateralRaw && tokenList.length === collateralRaw.length) {
      tokenList.forEach((t, i) => {
        const r = collateralRaw[i];
        if (r.status !== "success") return;
        const sharesRaw = r.result as bigint;
        if (sharesRaw === 0n) return;
        const shares = Number(formatUnits(sharesRaw, 18));
        const price = livePrices[t.sym]?.price ?? findStock(t.sym).price;
        lines.push({
          sym: t.sym,
          shares,
          sharesRaw,
          value: shares * price,
          weight: 0, // filled below once we know the total
        });
      });
      const total = lines.reduce((a, x) => a + x.value, 0);
      if (total > 0) {
        for (const l of lines) l.weight = l.value / total;
      }
    }

    return {
      connected: true,
      vaultConfigured: true,
      hasPosition: borrowedUsd > 0 || lines.length > 0,
      collateralUsd,
      borrowedUsd,
      healthFactor,
      liqThresholdPct,
      lines,
      loading,
      oracleStale,
    };
  }, [
    isConnected,
    vaultConfigured,
    liqThresholdPct,
    positionRaw,
    collateralRaw,
    posLoading,
    collLoading,
    tokenList,
    livePrices,
    oracleStale,
  ]);
}
