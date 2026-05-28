"use client";

import { useMemo } from "react";
import { useBlockNumber, usePublicClient } from "wagmi";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { parseAbiItem, type Address } from "viem";
import {
  EQUIFLOW_VAULT_ADDRESS,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { getLogsChunked } from "@/lib/web3/get-logs-chunked";

/// ─── usePositionEvents ──────────────────────────────────────────────────
///
/// Scans vault history for a single user and returns their position-related
/// txs (pledge, repay, withdraw, liquidation) merged + sorted newest-first.
/// Powers the "Position transactions" panel on /positions.
///
/// Why a separate hook from use-recent-liquidations: that one is org-wide
/// (all liquidations across the protocol); this one is per-user across all
/// event types. They share the same getLogsChunked plumbing.

/// Reverse token-address → symbol map, built once.
const SYMBOL_BY_ADDRESS = (() => {
  const m: Record<string, string> = {};
  for (const [sym, addr] of Object.entries(STOCK_TOKEN_ADDRESSES)) {
    if (addr) m[addr.toLowerCase()] = sym;
  }
  return m;
})();

/// ~24h at RBN's 0.25s/block. Used only for the FIRST scan when no cache exists;
/// subsequent scans only fetch the delta since `lastScannedBlock` in localStorage,
/// so history grows monotonically and survives across sessions.
const RECENT_WINDOW_BLOCKS = 345_600n;
const SECS_PER_BLOCK = 0.25;
// Bump the version suffix to invalidate browser localStorage caches whenever
// the event-label formatting changes (e.g. v1 → v2 fix for LP USDG decimals).
// Old `v1` entries will be orphaned in localStorage but stop being read; the
// `v2` re-scan starts from genesis on next page load.
const CACHE_KEY_PREFIX = "equiflow:position-events:v2";

interface CachedShape {
  lastScannedBlock: string;
  events: Array<Omit<PositionEvent, "blockNumber" | "timestamp"> & {
    blockNumber: string;
    timestamp: number;
  }>;
}

function cacheKey(vault: Address | undefined, user: Address): string {
  return `${CACHE_KEY_PREFIX}:${(vault ?? "0x0").toLowerCase()}:${user.toLowerCase()}`;
}

function loadCache(key: string): { lastScannedBlock: bigint; events: PositionEvent[] } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedShape;
    return {
      lastScannedBlock: BigInt(parsed.lastScannedBlock),
      events: parsed.events.map((e) => ({
        ...e,
        blockNumber: BigInt(e.blockNumber),
        timestamp: new Date(e.timestamp),
      })),
    };
  } catch {
    return null;
  }
}

function saveCache(key: string, lastScannedBlock: bigint, events: PositionEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedShape = {
      lastScannedBlock: lastScannedBlock.toString(),
      events: events.map((e) => ({
        ...e,
        blockNumber: e.blockNumber.toString(),
        timestamp: e.timestamp.getTime(),
      })),
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // localStorage full or disabled — silently no-op
  }
}

const PLEDGED_EVENT = parseAbiItem(
  "event Pledged(address indexed user, address indexed token, uint256 amount, uint256 borrowedUsd)",
);
const REPAID_EVENT = parseAbiItem(
  "event Repaid(address indexed user, uint256 amount)",
);
const WITHDRAWN_EVENT = parseAbiItem(
  "event Withdrawn(address indexed user, address indexed token, uint256 amount)",
);
const LIQUIDATED_EVENT = parseAbiItem(
  "event Liquidated(address indexed user, address indexed liquidator, address indexed token, uint256 collateralSeized, uint256 debtRepaid)",
);
/// LP-side events — emitted by `lpDeposit()` and `lpWithdraw()`. These belong
/// to the same wallet but represent a separate role (USDG liquidity provider)
/// alongside the borrower role. Surface them with distinct labels/colors so
/// the user can tell at a glance whether a row is collateral-flow or LP-flow.
const LP_DEPOSITED_EVENT = parseAbiItem(
  "event LpDeposited(address indexed lp, uint256 usdgAmount, uint256 sharesMinted)",
);
const LP_WITHDRAWN_EVENT = parseAbiItem(
  "event LpWithdrawn(address indexed lp, uint256 usdgAmount, uint256 sharesBurned)",
);

/// USDG raw-unit scale — vault emits LP event `usdgAmount` in raw token units
/// (6 decimals on RBN testnet), not the 1e18-scaled USD used by borrow/repay/
/// liquidation events. Hardcoded here because USDG decimals are immutable per
/// vault deploy and the position-events hook would otherwise need an extra
/// RPC roundtrip on every page load just to read `vault.usdcDecimals()`.
/// If a future deploy changes USDG decimals (unlikely — USDC and PYUSD-grade
/// stablecoins are universally 6-dec), update this constant.
const USDG_DECIMALS = 6;

export type PositionEventKind =
  | "pledge"
  | "borrow"
  | "repay"
  | "withdraw"
  | "liquidated"
  | "lp-deposit"
  | "lp-withdraw";

export interface PositionEvent {
  kind: PositionEventKind;
  /// Resolved ticker if token is recognized (e.g. "AMZN"), null for unknowns.
  symbol: string | null;
  /// Token contract address (if applicable; null for pure-USDG events like Repaid).
  token: Address | null;
  /// Human-readable label for the row, computed from kind + amounts.
  label: string;
  /// Signed USD-cents string for the right-side value column, e.g. "+$11.15" or
  /// "−$5.00". null when the event has no scalar value to show.
  valueDisplay: string | null;
  /// CSS hint for value color. Borrower flows use "up"/"down" (USDG into/out
  /// of wallet) and "neutral" for collateral movements. LP flows use their own
  /// pair ("lp-deposit" = brand-blue, "lp-withdraw" = amber) so they read as
  /// a visually distinct lane from the borrow/repay rows.
  valueColor: "up" | "down" | "neutral" | "lp-deposit" | "lp-withdraw";
  blockNumber: bigint;
  txHash: `0x${string}`;
  /// Approximate JS Date — derived from blockNumber × block-time (no extra
  /// RPC round-trip per row).
  timestamp: Date;
}

function fmtUsd(amount: bigint, decimals: number, signPrefix?: "+" | "−"): string {
  const n = Number(amount) / 10 ** decimals;
  const sign = signPrefix ?? "";
  if (n === 0) return `${sign}$0`;
  if (n < 0.01) return `${sign}<$0.01`;
  if (n < 100) return `${sign}$${n.toFixed(2)}`;
  if (n < 100_000) return `${sign}$${n.toFixed(0)}`;
  return `${sign}$${(n / 1000).toFixed(1)}k`;
}

function fmtTokenAmt(amount: bigint, decimals: number): string {
  const n = Number(amount) / 10 ** decimals;
  if (n === 0) return "0";
  if (n < 0.001) return n.toExponential(2);
  if (n < 100) return n.toFixed(4);
  return n.toFixed(2);
}

export function usePositionEvents(user: Address | undefined): {
  events: PositionEvent[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const client = usePublicClient({ chainId: ROBINHOOD_CHAIN_TESTNET_ID });
  const { data: head } = useBlockNumber({
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { refetchInterval: 60_000 },
  });

  /// Bucket head by ~5min (1200 blocks) so the query key doesn't churn every
  /// block. Same trick as use-recent-liquidations.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "equiflow",
      "position-events",
      EQUIFLOW_VAULT_ADDRESS,
      user?.toLowerCase() ?? "anon",
      head ? (head / 1200n).toString() : "0",
    ],
    queryFn: async (): Promise<PositionEvent[]> => {
      if (!client || !EQUIFLOW_VAULT_ADDRESS || !head || !user) return [];

      const key = cacheKey(EQUIFLOW_VAULT_ADDRESS, user);
      const cached = loadCache(key);

      // First-time scan: use 24h window. Subsequent scans: only fetch new blocks.
      const fromBlock = cached
        ? cached.lastScannedBlock + 1n
        : head > RECENT_WINDOW_BLOCKS
          ? head - RECENT_WINDOW_BLOCKS
          : 0n;

      // Nothing new to fetch — return cached events as-is.
      if (cached && fromBlock > head) {
        return cached.events;
      }

      const userTopic = user; // viem accepts plain address for indexed arg

      /// Run all six event scans in parallel — getLogsChunked already
      /// parallelizes within each scan, but launching them together halves
      /// wall-clock latency further.
      const [pledged, repaid, withdrawn, liquidated, lpDeposited, lpWithdrawn] =
        await Promise.all([
          getLogsChunked({
            client,
            address: EQUIFLOW_VAULT_ADDRESS,
            event: PLEDGED_EVENT,
            fromBlock,
            toBlock: head,
            // Note: getLogsChunked doesn't accept indexed filters today, so we
            // pull all events and filter client-side. For per-user views this is
            // wasteful on large vaults, but on a testnet with ~5 borrowers it's
            // fine. Add a `topics` field to getLogsChunked when this grows.
          }),
          getLogsChunked({
            client,
            address: EQUIFLOW_VAULT_ADDRESS,
            event: REPAID_EVENT,
            fromBlock,
            toBlock: head,
          }),
          getLogsChunked({
            client,
            address: EQUIFLOW_VAULT_ADDRESS,
            event: WITHDRAWN_EVENT,
            fromBlock,
            toBlock: head,
          }),
          getLogsChunked({
            client,
            address: EQUIFLOW_VAULT_ADDRESS,
            event: LIQUIDATED_EVENT,
            fromBlock,
            toBlock: head,
          }),
          getLogsChunked({
            client,
            address: EQUIFLOW_VAULT_ADDRESS,
            event: LP_DEPOSITED_EVENT,
            fromBlock,
            toBlock: head,
          }),
          getLogsChunked({
            client,
            address: EQUIFLOW_VAULT_ADDRESS,
            event: LP_WITHDRAWN_EVENT,
            fromBlock,
            toBlock: head,
          }),
        ]);

      const now = Date.now();
      const userLower = userTopic.toLowerCase();
      const out: PositionEvent[] = [];

      for (const log of pledged) {
        if ((log.args.user ?? "").toLowerCase() !== userLower) continue;
        const token = log.args.token!;
        const sym = SYMBOL_BY_ADDRESS[token.toLowerCase()] ?? null;
        const amount = log.args.amount ?? 0n;
        const borrowedUsd = log.args.borrowedUsd ?? 0n;
        const ageMs = Number(head - log.blockNumber) * SECS_PER_BLOCK * 1000;

        // Most pledgeAndBorrow calls do both at once. Emit ONE row for the
        // pledge half, and a separate borrow row only if borrowedUsd > 0 — so
        // the UI reads naturally as "pledged X, borrowed Y".
        out.push({
          kind: "pledge",
          symbol: sym,
          token,
          label: `Pledged · ${fmtTokenAmt(amount, 18)} ${sym ?? "tokens"}`,
          valueDisplay: null, // no USD value at pledge time (collateral)
          valueColor: "neutral",
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          timestamp: new Date(now - ageMs),
        });
        if (borrowedUsd > 0n) {
          out.push({
            kind: "borrow",
            symbol: "USDG",
            token: null,
            label: `Borrowed · ${fmtUsd(borrowedUsd, 18)} USDG`,
            valueDisplay: fmtUsd(borrowedUsd, 18, "+"),
            valueColor: "up",
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            timestamp: new Date(now - ageMs),
          });
        }
      }

      for (const log of repaid) {
        if ((log.args.user ?? "").toLowerCase() !== userLower) continue;
        const amount = log.args.amount ?? 0n;
        const ageMs = Number(head - log.blockNumber) * SECS_PER_BLOCK * 1000;
        out.push({
          kind: "repay",
          symbol: "USDG",
          token: null,
          label: `Repaid · ${fmtUsd(amount, 18)} USDG`,
          valueDisplay: fmtUsd(amount, 18, "−"),
          valueColor: "down",
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          timestamp: new Date(now - ageMs),
        });
      }

      for (const log of withdrawn) {
        if ((log.args.user ?? "").toLowerCase() !== userLower) continue;
        const token = log.args.token!;
        const sym = SYMBOL_BY_ADDRESS[token.toLowerCase()] ?? null;
        const amount = log.args.amount ?? 0n;
        const ageMs = Number(head - log.blockNumber) * SECS_PER_BLOCK * 1000;
        out.push({
          kind: "withdraw",
          symbol: sym,
          token,
          label: `Withdrawn · ${fmtTokenAmt(amount, 18)} ${sym ?? "tokens"}`,
          valueDisplay: null,
          valueColor: "neutral",
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          timestamp: new Date(now - ageMs),
        });
      }

      for (const log of liquidated) {
        if ((log.args.user ?? "").toLowerCase() !== userLower) continue;
        const token = log.args.token!;
        const sym = SYMBOL_BY_ADDRESS[token.toLowerCase()] ?? null;
        const collateralSeized = log.args.collateralSeized ?? 0n;
        const debtRepaid = log.args.debtRepaid ?? 0n;
        const ageMs = Number(head - log.blockNumber) * SECS_PER_BLOCK * 1000;
        out.push({
          kind: "liquidated",
          symbol: sym,
          token,
          label: `Liquidated · ${fmtTokenAmt(collateralSeized, 18)} ${sym ?? "tokens"} seized`,
          valueDisplay: fmtUsd(debtRepaid, 18, "−"),
          valueColor: "down",
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          timestamp: new Date(now - ageMs),
        });
      }

      /// LP deposit: USDG → LP shares. Arrow direction "→" mirrors the on-chain
      /// flow (capital flowing INTO yield position). Brand-blue color sets these
      /// rows apart from collateral/debt rows visually.
      ///
      /// NOTE: `usdgAmount` is emitted in RAW USDG units (6 decimals) — not the
      /// 1e18-scaled USD used by Pledged/Repaid/Liquidated. Using 18 here makes
      /// a 10 USDG deposit display as <$0.01 (10e6 / 1e18 ≈ 1e-11).
      for (const log of lpDeposited) {
        if ((log.args.lp ?? "").toLowerCase() !== userLower) continue;
        const usdg = log.args.usdgAmount ?? 0n;
        const shares = log.args.sharesMinted ?? 0n;
        const ageMs = Number(head - log.blockNumber) * SECS_PER_BLOCK * 1000;
        out.push({
          kind: "lp-deposit",
          symbol: "USDG",
          token: null,
          label: `LP deposit · ${fmtUsd(usdg, USDG_DECIMALS)} USDG → ${fmtTokenAmt(shares, 18)} shares`,
          valueDisplay: fmtUsd(usdg, USDG_DECIMALS, "+"),
          valueColor: "lp-deposit",
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          timestamp: new Date(now - ageMs),
        });
      }

      /// LP withdraw: LP shares → USDG. Arrow direction "←" mirrors capital
      /// flowing OUT of yield position back to wallet. Amber color stays in the
      /// LP visual family but reads as "leaving" vs the brand-blue "entering".
      /// `usdgAmount` is RAW USDG (6 dec) — see LP deposit comment above.
      for (const log of lpWithdrawn) {
        if ((log.args.lp ?? "").toLowerCase() !== userLower) continue;
        const usdg = log.args.usdgAmount ?? 0n;
        const shares = log.args.sharesBurned ?? 0n;
        const ageMs = Number(head - log.blockNumber) * SECS_PER_BLOCK * 1000;
        out.push({
          kind: "lp-withdraw",
          symbol: "USDG",
          token: null,
          label: `LP withdraw · ${fmtUsd(usdg, USDG_DECIMALS)} USDG ← ${fmtTokenAmt(shares, 18)} shares`,
          valueDisplay: fmtUsd(usdg, USDG_DECIMALS, "−"),
          valueColor: "lp-withdraw",
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          timestamp: new Date(now - ageMs),
        });
      }

      /// Merge with cached events (cache survives across sessions, so the
      /// history panel grows monotonically and never "disappears" after 24h).
      const merged = cached ? [...cached.events, ...out] : out;

      /// Deduplicate on (txHash, kind, blockNumber) — same tx can emit pledge
      /// + borrow rows, but a re-scan should never duplicate either row.
      const seen = new Set<string>();
      const deduped: PositionEvent[] = [];
      for (const e of merged) {
        const dedupKey = `${e.txHash}:${e.kind}:${e.blockNumber.toString()}:${e.symbol ?? ""}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        deduped.push(e);
      }

      /// Newest-first. Tie-break by kind so a pledge+borrow pair stays
      /// adjacent with the borrow row immediately below the pledge.
      deduped.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return a.blockNumber > b.blockNumber ? -1 : 1;
        }
        return a.kind === "pledge" ? -1 : 1;
      });

      saveCache(key, head, deduped);
      return deduped;
    },
    enabled: !!client && !!EQUIFLOW_VAULT_ADDRESS && !!head && !!user,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
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
