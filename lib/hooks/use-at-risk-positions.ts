"use client";

import { useMemo } from "react";
import {
  useBlockNumber,
  usePublicClient,
  useReadContracts,
} from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address } from "viem";
import {
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { getLogsChunked } from "@/lib/web3/get-logs-chunked";

/// Discovers borrowers across the protocol via `Pledged` events, then reads
/// each one's current position/health-factor and returns the worst-off N for
/// the /liquidations page.
///
/// Why event-scan instead of a contract getter: the vault doesn't expose
/// `getAllBorrowers()` (would need an iterable EnumerableSet). Event scan is
/// the canonical alternative — Aave's UI does the same on archive nodes.
///
/// Two-stage caching:
///   1. Unique-borrowers list is `staleTime: 5 min` — borrowers don't churn
///      that fast and the getLogs call is expensive.
///   2. Per-borrower positionOf/healthFactor refetched every 30s via
///      useReadContracts so the at-risk leaderboard updates in near real-time
///      as prices move.

const POLL_MS = 30_000;
/// RBN block time ≈ 0.25 s → 24h ≈ 345_600 blocks. Public RPCs choke on much
/// larger ranges, so we cap discovery to the last ~24h of borrowing activity.
const PLEDGE_SCAN_BLOCKS = 345_600n;

const PLEDGED_EVENT = parseAbiItem(
  "event Pledged(address indexed user, address indexed token, uint256 amount, uint256 borrowedUsd)",
);

export interface AtRiskPosition {
  user: Address;
  /** 1e18-scaled. HF < 1e18 = liquidatable. */
  healthFactor: bigint;
  /** 1e18 USD units. */
  collateralUsd: bigint;
  /** 1e18 USD units. Total debt. */
  borrowedUsd: bigint;
  /** Convenience: borrowedUsd > 0 && healthFactor < 1e18. */
  isLiquidatable: boolean;
  /** healthFactor as a decimal number — convenient for sorting & display. */
  hf: number;
}

const ONE_E18 = 10n ** 18n;

export interface AtRiskResult {
  positions: AtRiskPosition[];
  /** Distinct borrowers discovered in the scanned window. */
  borrowersScanned: number;
  /** Subset with non-zero debt right now. */
  activeBorrowers: number;
  /** Subset with HF < 1e18. */
  liquidatableCount: number;
  /** Total debt held by liquidatable positions (1e18 USD units). */
  totalDebtAtRiskUsd: bigint;
  isLoading: boolean;
  /** True when the Pledged event scan failed (RPC outage / rate limit). */
  isError: boolean;
  error: Error | null;
}

export function useAtRiskPositions(): AtRiskResult {
  /// Stage 1: scan Pledged events to discover unique borrowers.
  const client = usePublicClient({ chainId: ROBINHOOD_CHAIN_TESTNET_ID });
  const { data: head } = useBlockNumber({
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { refetchInterval: 60_000 },
  });

  const {
    data: borrowers,
    isError: isBorrowersError,
    error: borrowersError,
  } = useQuery({
    queryKey: [
      "equiflow",
      "borrowers",
      EQUIFLOW_VAULT_ADDRESS,
      // Bucket head to ~5 min so getLogs is cached aggressively.
      head ? (head / 1200n).toString() : "0",
    ],
    queryFn: async (): Promise<Address[]> => {
      if (!client || !EQUIFLOW_VAULT_ADDRESS || !head) return [];
      const fromBlock =
        head > PLEDGE_SCAN_BLOCKS ? head - PLEDGE_SCAN_BLOCKS : 0n;
      /// Errors propagate to React Query — silent fallbacks made an offline
      /// RPC look identical to a healthy-but-empty protocol.
      const logs = await getLogsChunked({
        client,
        address: EQUIFLOW_VAULT_ADDRESS,
        event: PLEDGED_EVENT,
        fromBlock,
        toBlock: head,
      });
      const seen = new Set<string>();
      const out: Address[] = [];
      for (const log of logs) {
        const u = log.args.user;
        if (!u) continue;
        const key = u.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(u);
        }
      }
      return out;
    },
    enabled: !!client && !!EQUIFLOW_VAULT_ADDRESS && !!head,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  /// Stage 2: per-borrower positionOf + healthFactor in a single multicall.
  const contracts = useMemo(() => {
    if (!borrowers || !EQUIFLOW_VAULT_ADDRESS) return [];
    return borrowers.flatMap((u) => [
      {
        abi: EQUIFLOW_VAULT_ABI,
        address: EQUIFLOW_VAULT_ADDRESS,
        functionName: "positionOf" as const,
        args: [u] as const,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        abi: EQUIFLOW_VAULT_ABI,
        address: EQUIFLOW_VAULT_ADDRESS,
        functionName: "healthFactor" as const,
        args: [u] as const,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
    ]);
  }, [borrowers]);

  const { data: rows, isLoading: isPositionsLoading } = useReadContracts({
    allowFailure: true,
    contracts,
    query: {
      enabled: contracts.length > 0,
      refetchInterval: POLL_MS,
    },
  });

  const result = useMemo<AtRiskResult>(() => {
    if (!borrowers) {
      return {
        positions: [],
        borrowersScanned: 0,
        activeBorrowers: 0,
        liquidatableCount: 0,
        totalDebtAtRiskUsd: 0n,
        isLoading: !isBorrowersError,
        isError: isBorrowersError,
        error: (borrowersError as Error | null) ?? null,
      };
    }
    const positions: AtRiskPosition[] = [];
    let active = 0;
    let liquidatable = 0;
    let totalAtRisk = 0n;
    for (let i = 0; i < borrowers.length; i++) {
      const positionR = rows?.[i * 2];
      const hfR = rows?.[i * 2 + 1];
      if (positionR?.status !== "success" || hfR?.status !== "success") continue;
      const [collateralUsd, borrowedUsd] = positionR.result as readonly [
        bigint,
        bigint,
        bigint,
      ];
      const healthFactor = hfR.result as bigint;
      if (borrowedUsd === 0n) continue;
      active++;
      const liq = healthFactor < ONE_E18;
      if (liq) {
        liquidatable++;
        totalAtRisk += borrowedUsd;
      }
      positions.push({
        user: borrowers[i],
        healthFactor,
        collateralUsd,
        borrowedUsd,
        isLiquidatable: liq,
        // Convert HF to a JS number, capped at 999 to avoid Infinity in sort.
        hf: Number(
          healthFactor > 999n * ONE_E18
            ? 999n * ONE_E18
            : healthFactor,
        ) / 1e18,
      });
    }
    /// Sort ascending — most at-risk first.
    positions.sort((a, b) => a.hf - b.hf);
    return {
      positions,
      borrowersScanned: borrowers.length,
      activeBorrowers: active,
      liquidatableCount: liquidatable,
      totalDebtAtRiskUsd: totalAtRisk,
      isLoading: contracts.length > 0 && isPositionsLoading,
      isError: isBorrowersError,
      error: (borrowersError as Error | null) ?? null,
    };
  }, [
    borrowers,
    rows,
    contracts.length,
    isPositionsLoading,
    isBorrowersError,
    borrowersError,
  ]);

  return result;
}
