"use client";

import { useMemo } from "react";
import {
  useBlockNumber,
  usePublicClient,
  useReadContract,
} from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address } from "viem";
import {
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { getLogsChunked } from "@/lib/web3/get-logs-chunked";

/// Reverse token-address → symbol map, built once. Vault Liquidated events
/// carry the token address; we resolve it to a ticker for the UI.
const SYMBOL_BY_ADDRESS = (() => {
  const m: Record<string, string> = {};
  for (const [sym, addr] of Object.entries(STOCK_TOKEN_ADDRESSES)) {
    if (addr) m[addr.toLowerCase()] = sym;
  }
  return m;
})();

/// Pulls Liquidated events from the vault and returns them as a typed array
/// for the recent-history table on /liquidations.
///
/// Companion to `useLiquidations` in use-protocol-stats.ts — that hook is
/// aggregate only (count + summed debt). This one surfaces the row-level
/// detail the UI needs: who, target, asset, when.

/// Block time on RBN ≈ 0.25s → 24h ≈ 345_600 blocks. We scan this window for
/// the recent table. Public RPCs choke beyond it.
const RECENT_WINDOW_BLOCKS = 345_600n;

const LIQUIDATED_EVENT = parseAbiItem(
  "event Liquidated(address indexed user, address indexed liquidator, address indexed token, uint256 collateralSeized, uint256 debtRepaid)",
);

export interface RecentLiquidation {
  liquidator: Address;
  target: Address;
  token: Address;
  /// Resolved ticker symbol if the token is one of the listed stocks.
  symbol: string | null;
  /// 1e18 USD units (the vault emits the dollar value of repayment).
  debtRepaid: bigint;
  /// 1e18-scaled collateral USD value seized.
  collateralSeized: bigint;
  /// 5 % of debt repaid — what the liquidator pocketed.
  bonusUsd: bigint;
  blockNumber: bigint;
  txHash: string;
  /// JS Date timestamp for relative-time formatting (best-effort: we approximate
  /// from blockNumber × block-time when the block timestamp isn't fetched).
  timestamp: Date;
}

const FALLBACK_BONUS_BPS = 500n;
const SECS_PER_BLOCK = 0.25;

export function useRecentLiquidations(options?: { paused?: boolean }): {
  events: RecentLiquidation[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  /// When paused, keep cached events but stop the periodic getLogs rescan —
  /// wired to the page's "Live / Paused" toggle.
  const paused = options?.paused ?? false;
  const client = usePublicClient({ chainId: ROBINHOOD_CHAIN_TESTNET_ID });
  const { data: head } = useBlockNumber({
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { refetchInterval: 60_000 },
  });
  const { data: bonusBpsRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS,
    functionName: "LIQUIDATION_BONUS_BPS",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!EQUIFLOW_VAULT_ADDRESS, staleTime: Infinity },
  });
  const bonusBps = bonusBpsRaw != null
    ? BigInt(bonusBpsRaw as bigint)
    : FALLBACK_BONUS_BPS;

  /// Cache fairly aggressively — chunked getLogs over 345K blocks fires ~35
  /// requests on RBN testnet. Bucket the head so the query key only changes
  /// every ~5 minutes.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "equiflow",
      "recent-liquidations",
      EQUIFLOW_VAULT_ADDRESS,
      head ? (head / 1200n).toString() : "0",
    ],
    queryFn: async (): Promise<RecentLiquidation[]> => {
      if (!client || !EQUIFLOW_VAULT_ADDRESS || !head) return [];
      const fromBlock =
        head > RECENT_WINDOW_BLOCKS ? head - RECENT_WINDOW_BLOCKS : 0n;
      /// Errors propagate to React Query so the UI can show an RPC banner —
      /// silent fallbacks would mask a degraded public RPC.
      const logs = await getLogsChunked({
        client,
        address: EQUIFLOW_VAULT_ADDRESS,
        event: LIQUIDATED_EVENT,
        fromBlock,
        toBlock: head,
      });
      const now = Date.now();
      const events: RecentLiquidation[] = logs
        .map((log) => {
          const user = log.args.user!;
          const liquidator = log.args.liquidator!;
          const token = log.args.token!;
          const debtRepaid = log.args.debtRepaid ?? 0n;
          const collateralSeized = log.args.collateralSeized ?? 0n;
          const ageBlocks = head - log.blockNumber;
          const ageMs = Number(ageBlocks) * SECS_PER_BLOCK * 1000;
          const sym = SYMBOL_BY_ADDRESS[token.toLowerCase()] ?? null;
          return {
            liquidator,
            target: user,
            token,
            symbol: sym,
            debtRepaid,
            collateralSeized,
            bonusUsd: (debtRepaid * bonusBps) / 10_000n,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            timestamp: new Date(now - ageMs),
          };
        })
        /// Newest first.
        .sort((a, b) =>
          a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0,
        );
      return events;
    },
    enabled: !!client && !!EQUIFLOW_VAULT_ADDRESS && !!head,
    staleTime: 5 * 60_000,
    refetchInterval: paused ? false : 5 * 60_000,
    /// Backoff: 1s → 2s → 4s for the three retries. Public RPC blips recover
    /// fast; longer waits just leave the page empty.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  return useMemo(
    () => ({
      events: data ?? [],
      isLoading,
      isError,
      error: (error as Error | null) ?? null,
    }),
    [data, isLoading, isError, error],
  );
}

/// Aggregate 24-hour histogram for the timeline chart. Bins liquidations by
/// hour relative to `now`. Returns an array of length 24 in chronological
/// order (oldest first, newest last).
export function bucketByHour(
  events: RecentLiquidation[],
): { hour: number; count: number }[] {
  const out: { hour: number; count: number }[] = [];
  const now = Date.now();
  for (let i = 23; i >= 0; i--) {
    const start = now - (i + 1) * 3600_000;
    const end = now - i * 3600_000;
    const count = events.filter(
      (e) => e.timestamp.getTime() >= start && e.timestamp.getTime() < end,
    ).length;
    out.push({ hour: 23 - i, count });
  }
  return out;
}

/// Relative-time string used by the recent table.
export function relTime(d: Date): string {
  const diff = Math.max(0, Date.now() - d.getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
