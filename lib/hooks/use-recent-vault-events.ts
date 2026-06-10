"use client";

import { useMemo } from "react";
import { useBlockNumber, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address } from "viem";
import {
  EQUIFLOW_VAULT_ADDRESS,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { getLogsChunked } from "@/lib/web3/get-logs-chunked";

/// ─── useRecentVaultEvents ───────────────────────────────────────────────
///
/// Protocol-wide feed of recent vault activity (any borrower, any LP). Powers
/// the "Recent pledges" panel on /pledge.
///
/// Sibling of usePositionEvents — that hook narrows by `user` for the
/// /positions page. This one returns the global stream.

const SYMBOL_BY_ADDRESS = (() => {
  const m: Record<string, string> = {};
  for (const [sym, addr] of Object.entries(STOCK_TOKEN_ADDRESSES)) {
    if (addr) m[addr.toLowerCase()] = sym;
  }
  return m;
})();

/// 30-minute window — keeps the panel scoped to "right now" rather than 24h.
/// At RBN's 0.25s/block that's 7200 blocks. Public RPC handles this trivially.
const RECENT_WINDOW_BLOCKS = 7_200n;
const SECS_PER_BLOCK = 0.25;
const MAX_ROWS = 8;

const PLEDGED_EVENT = parseAbiItem(
  "event Pledged(address indexed user, address indexed token, uint256 amount, uint256 borrowedUsd)",
);
const REPAID_EVENT = parseAbiItem(
  "event Repaid(address indexed user, uint256 amount)",
);
const LIQUIDATED_EVENT = parseAbiItem(
  "event Liquidated(address indexed user, address indexed liquidator, address indexed token, uint256 collateralSeized, uint256 debtRepaid)",
);

export type RecentEventKind = "pledge" | "repay" | "liquidated";

export interface RecentVaultEvent {
  kind: RecentEventKind;
  actor: Address;
  symbol: string | null;
  /// One-line description ready for direct render.
  label: string;
  blockNumber: bigint;
  txHash: `0x${string}`;
  timestamp: Date;
}

function fmtUsd(amount: bigint, decimals: number): string {
  const n = Number(amount) / 10 ** decimals;
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  if (n < 100) return `$${n.toFixed(2)}`;
  if (n < 100_000) return `$${n.toFixed(0)}`;
  return `$${(n / 1000).toFixed(1)}k`;
}

function fmtTokenAmt(amount: bigint, decimals: number): string {
  const n = Number(amount) / 10 ** decimals;
  if (n === 0) return "0";
  if (n < 0.001) return n.toExponential(2);
  if (n < 100) return n.toFixed(4);
  return n.toFixed(2);
}

export function useRecentVaultEvents(opts?: {
  /// Look-back window in blocks. Default 7_200 (~30 min at 0.25s/block).
  /// The landing page passes ~24h — a quiet testnet rarely has 30-min-fresh
  /// activity, and real-but-older rows beat an empty feed.
  windowBlocks?: bigint;
  /// Override the getLogs chunk size. The vault address is sparse, so the
  /// public RPC accepts the whole 24h range in one call — pass a chunk at
  /// least as large as the window to avoid fanning out dozens of requests.
  chunkBlocks?: bigint;
}): {
  events: RecentVaultEvent[];
  isLoading: boolean;
  isError: boolean;
} {
  const windowBlocks = opts?.windowBlocks ?? RECENT_WINDOW_BLOCKS;
  const chunkBlocks = opts?.chunkBlocks;
  const client = usePublicClient({ chainId: ROBINHOOD_CHAIN_TESTNET_ID });
  const { data: head } = useBlockNumber({
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { refetchInterval: 30_000 },
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "equiflow",
      "recent-vault-events",
      EQUIFLOW_VAULT_ADDRESS,
      windowBlocks.toString(),
      // Bucket head by ~1min (240 blocks) — recent panel should feel live but
      // not refetch on every new block.
      head ? (head / 240n).toString() : "0",
    ],
    queryFn: async (): Promise<RecentVaultEvent[]> => {
      if (!client || !EQUIFLOW_VAULT_ADDRESS || !head) return [];
      const fromBlock = head > windowBlocks ? head - windowBlocks : 0n;
      const now = Date.now();

      const [pledged, repaid, liquidated] = await Promise.all([
        getLogsChunked({
          client,
          address: EQUIFLOW_VAULT_ADDRESS,
          event: PLEDGED_EVENT,
          fromBlock,
          toBlock: head,
          chunkBlocks,
        }),
        getLogsChunked({
          client,
          address: EQUIFLOW_VAULT_ADDRESS,
          event: REPAID_EVENT,
          fromBlock,
          toBlock: head,
          chunkBlocks,
        }),
        getLogsChunked({
          client,
          address: EQUIFLOW_VAULT_ADDRESS,
          event: LIQUIDATED_EVENT,
          fromBlock,
          toBlock: head,
          chunkBlocks,
        }),
      ]);

      const out: RecentVaultEvent[] = [];

      for (const log of pledged) {
        const user = log.args.user!;
        const token = log.args.token!;
        const sym = SYMBOL_BY_ADDRESS[token.toLowerCase()] ?? null;
        const amount = log.args.amount ?? 0n;
        const borrowedUsd = log.args.borrowedUsd ?? 0n;
        const ageMs = Number(head - log.blockNumber) * SECS_PER_BLOCK * 1000;
        const tokenPart = `${fmtTokenAmt(amount, 18)} ${sym ?? "tokens"}`;
        const borrowPart =
          borrowedUsd > 0n
            ? ` · borrow ${fmtUsd(borrowedUsd, 18)} USDG`
            : "";
        out.push({
          kind: "pledge",
          actor: user,
          symbol: sym,
          label: `Pledge ${tokenPart}${borrowPart}`,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          timestamp: new Date(now - ageMs),
        });
      }

      for (const log of repaid) {
        const user = log.args.user!;
        const amount = log.args.amount ?? 0n;
        const ageMs = Number(head - log.blockNumber) * SECS_PER_BLOCK * 1000;
        out.push({
          kind: "repay",
          actor: user,
          symbol: "USDG",
          label: `Repay ${fmtUsd(amount, 18)} USDG`,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          timestamp: new Date(now - ageMs),
        });
      }

      for (const log of liquidated) {
        const user = log.args.user!;
        const token = log.args.token!;
        const sym = SYMBOL_BY_ADDRESS[token.toLowerCase()] ?? null;
        const collateralSeized = log.args.collateralSeized ?? 0n;
        const debtRepaid = log.args.debtRepaid ?? 0n;
        const ageMs = Number(head - log.blockNumber) * SECS_PER_BLOCK * 1000;
        out.push({
          kind: "liquidated",
          actor: user,
          symbol: sym,
          label: `Liquidated · ${fmtTokenAmt(collateralSeized, 18)} ${sym ?? "tokens"} seized · ${fmtUsd(debtRepaid, 18)} debt cleared`,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          timestamp: new Date(now - ageMs),
        });
      }

      out.sort((a, b) =>
        a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0,
      );
      return out.slice(0, MAX_ROWS);
    },
    enabled: !!client && !!EQUIFLOW_VAULT_ADDRESS && !!head,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  return {
    events: data ?? [],
    isLoading,
    isError,
  };
}
