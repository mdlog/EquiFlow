"use client";

import {
  useBlockNumber,
  usePublicClient,
} from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address } from "viem";
import {
  EQUIFLOW_VAULT_ADDRESS,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";

/// Per-asset on-chain activity feed for /markets/[sym].
///
/// Scans the last ~7d of `Pledged` and `Liquidated` events filtered to one
/// collateral token. Pledges and liquidations are the only events with token
/// in their indexed args — repays are protocol-wide (no per-asset filter
/// possible without further indexing), so we skip them here.

const PLEDGED_EVENT = parseAbiItem(
  "event Pledged(address indexed user, address indexed token, uint256 amount, uint256 borrowedUsd)",
);
const LIQUIDATED_EVENT = parseAbiItem(
  "event Liquidated(address indexed user, address indexed liquidator, address indexed token, uint256 collateralSeized, uint256 debtRepaid)",
);

/// RBN block time ≈ 0.25 s → 7d ≈ 2.4M blocks. Public RPCs cap getLogs at
/// ~10k blocks per call, so we scope to 24h here too. Real production deploys
/// would index this via a subgraph instead.
const SCAN_BLOCKS = 345_600n;

export type ActivityKind = "pledge" | "liquidation";

export interface ActivityEvent {
  kind: ActivityKind;
  /// For pledge: the borrower. For liquidation: the user being liquidated.
  actor: Address;
  /// For pledge: borrowedUsd (1e18). For liquidation: debtRepaid (1e18).
  amountUsd: bigint;
  /// For pledge: token amount (token-native units). For liquidation: collateralSeized.
  rawAmount: bigint;
  /// Liquidator that called the function (only set for liquidation).
  liquidator?: Address;
  blockNumber: bigint;
  txHash: `0x${string}`;
}

export interface AssetActivity {
  events: ActivityEvent[];
  isLoading: boolean;
}

export function useAssetActivity(token: Address | undefined): AssetActivity {
  const client = usePublicClient({ chainId: ROBINHOOD_CHAIN_TESTNET_ID });
  const { data: head } = useBlockNumber({
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { refetchInterval: 60_000 },
  });

  const { data, isLoading } = useQuery({
    queryKey: [
      "equiflow",
      "asset-activity",
      EQUIFLOW_VAULT_ADDRESS,
      token,
      // Bucket head so getLogs cache is shared across rapid renders.
      head ? (head / 1200n).toString() : "0",
    ],
    queryFn: async (): Promise<ActivityEvent[]> => {
      if (!client || !EQUIFLOW_VAULT_ADDRESS || !head || !token) return [];
      const fromBlock = head > SCAN_BLOCKS ? head - SCAN_BLOCKS : 0n;
      try {
        const [pledges, liqs] = await Promise.all([
          client.getLogs({
            address: EQUIFLOW_VAULT_ADDRESS,
            event: PLEDGED_EVENT,
            args: { token },
            fromBlock,
            toBlock: head,
          }),
          client.getLogs({
            address: EQUIFLOW_VAULT_ADDRESS,
            event: LIQUIDATED_EVENT,
            args: { token },
            fromBlock,
            toBlock: head,
          }),
        ]);
        const out: ActivityEvent[] = [];
        for (const l of pledges) {
          if (!l.args.user) continue;
          out.push({
            kind: "pledge",
            actor: l.args.user,
            amountUsd: l.args.borrowedUsd ?? 0n,
            rawAmount: l.args.amount ?? 0n,
            blockNumber: l.blockNumber,
            txHash: l.transactionHash,
          });
        }
        for (const l of liqs) {
          if (!l.args.user) continue;
          out.push({
            kind: "liquidation",
            actor: l.args.user,
            amountUsd: l.args.debtRepaid ?? 0n,
            rawAmount: l.args.collateralSeized ?? 0n,
            liquidator: l.args.liquidator,
            blockNumber: l.blockNumber,
            txHash: l.transactionHash,
          });
        }
        // Newest first.
        out.sort((a, b) =>
          a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0,
        );
        return out.slice(0, 30);
      } catch {
        // Rate-limit fallback — empty feed.
        return [];
      }
    },
    enabled: !!client && !!EQUIFLOW_VAULT_ADDRESS && !!head && !!token,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  return {
    events: data ?? [],
    isLoading: isLoading && !!token,
  };
}

/// RBN target block time for converting block-number deltas into wall time
/// without an extra RPC hit. ~0.25s in practice; use the average for display
/// without claiming exact precision.
export const RBN_AVG_BLOCK_TIME_SEC = 0.25;
