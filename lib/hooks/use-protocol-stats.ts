"use client";

import { useMemo } from "react";
import {
  useBlockNumber,
  usePublicClient,
  useReadContract,
  useReadContracts,
} from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address } from "viem";
import {
  ERC20_ABI,
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  USDC_ADDRESS,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { PYTH_ADAPTER_ABI } from "@/lib/web3/pyth";
import { deriveRates, type DerivedRates } from "@/lib/web3/irm";
import { getLogsChunked } from "@/lib/web3/get-logs-chunked";

export interface ProtocolStats {
  /** Total Value Locked = USDG vault balance + Σ (token.balanceOf(vault) × pythPrice). 1e18 USD units. */
  tvlUsd: bigint | null;
  /** Currently borrowed across all positions. 1e18 USD units. */
  borrowedUsd: bigint | null;
  /** Liquidation bonus in basis points (e.g. 500 = 5%). Read from contract constant. */
  liquidationBonusBps: number | null;
  /** USDG sitting in vault available to draw. 1e18 USD units. */
  liquidityUsd: bigint | null;
  /** borrowedUsd / liquidityUsd × 100. Null when liquidity is 0. */
  utilizationPct: number | null;
  /** Number of collateral assets listed in the vault. */
  assetCount: number | null;
  /** Liquidation events emitted in the last `liqWindowBlocks` blocks. */
  liquidations7d: { count: number; totalDebtUsd: bigint } | null;
  /** Loading: true while initial multicall round-trip hasn't resolved. */
  isLoading: boolean;
  /** Borrow + supply rates read directly from vault.borrowApyBps() and
   *  vault.lpApyBps(). Null while the initial RPC round-trip hasn't resolved. */
  derived: DerivedRates | null;
  /** Per-token collateral volume locked in vault, keyed by lowercase token address. 1e18 USD units. */
  collateralByToken: Record<string, bigint>;
}

const POLL_MS = 12_000;
// RBN testnet block time ≈ 0.25s → 7d ≈ 2.4M blocks. Public RPCs choke on
// that range, so we cap the scan to ~24h (≈ 345K blocks) which is the largest
// window still cheap enough for a single getLogs request.
const LIQ_WINDOW_BLOCKS = 345_600n;

export function useProtocolStats(
  listedAddrs: readonly Address[],
  overrideVaultAddress?: Address,
  overrideTokenAddress?: Address,
): ProtocolStats {
  // ── Vault-level singletons ────────────────────────────────────────────
  const vaultAddr = overrideVaultAddress ?? EQUIFLOW_VAULT_ADDRESS;
  const tokenAddr = overrideTokenAddress ?? USDC_ADDRESS;
  const enabled = !!vaultAddr;
  const { data: scalar } = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        abi: EQUIFLOW_VAULT_ABI,
        address: vaultAddr,
        functionName: "totalBorrowedUsd",
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        abi: ERC20_ABI,
        address: tokenAddr,
        functionName: "balanceOf",
        args: vaultAddr ? [vaultAddr] : undefined,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        abi: ERC20_ABI,
        address: tokenAddr,
        functionName: "decimals",
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        abi: EQUIFLOW_VAULT_ABI,
        address: vaultAddr,
        functionName: "reserveFactorBps",
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        abi: EQUIFLOW_VAULT_ABI,
        address: vaultAddr,
        functionName: "LIQUIDATION_BONUS_BPS",
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        abi: EQUIFLOW_VAULT_ABI,
        address: vaultAddr,
        functionName: "borrowApyBps",
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        abi: EQUIFLOW_VAULT_ABI,
        address: vaultAddr,
        functionName: "lpApyBps",
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        abi: EQUIFLOW_VAULT_ABI,
        address: vaultAddr,
        functionName: "utilizationBps",
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
    ],
    query: { enabled: enabled && !!tokenAddr, refetchInterval: POLL_MS },
  });

  const borrowedUsd =
    scalar?.[0].status === "success" ? (scalar[0].result as bigint) : null;
  const usdgBalRaw =
    scalar?.[1].status === "success" ? (scalar[1].result as bigint) : null;
  const usdgDecimals =
    scalar?.[2].status === "success" ? Number(scalar[2].result as number) : 6;
  const reserveFactorBps =
    scalar?.[3]?.status === "success"
      ? Number(scalar[3].result as bigint)
      : 1500;
  const liquidationBonusBps =
    scalar?.[4]?.status === "success"
      ? Number(scalar[4].result as bigint)
      : null;
  const onChainBorrowAprBps =
    scalar?.[5]?.status === "success"
      ? Number(scalar[5].result as bigint)
      : null;
  const onChainLpAprBps =
    scalar?.[6]?.status === "success"
      ? Number(scalar[6].result as bigint)
      : null;
  const onChainUtilBps =
    scalar?.[7]?.status === "success"
      ? Number(scalar[7].result as bigint)
      : null;

  // ── Per-asset reads: vault token balance + adapter address ────────────
  const balanceContracts = useMemo(
    () =>
      listedAddrs.map((addr) => ({
        abi: ERC20_ABI,
        address: addr,
        functionName: "balanceOf" as const,
        args: vaultAddr ? ([vaultAddr] as const) : undefined,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      })),
    [listedAddrs, vaultAddr],
  );
  const decimalsContracts = useMemo(
    () =>
      listedAddrs.map((addr) => ({
        abi: ERC20_ABI,
        address: addr,
        functionName: "decimals" as const,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      })),
    [listedAddrs],
  );
  const assetContracts = useMemo(
    () =>
      listedAddrs.map((addr) => ({
        abi: EQUIFLOW_VAULT_ABI,
        address: vaultAddr,
        functionName: "assets" as const,
        args: [addr] as const,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      })),
    [listedAddrs, vaultAddr],
  );

  const { data: perAsset } = useReadContracts({
    allowFailure: true,
    contracts: [...balanceContracts, ...decimalsContracts, ...assetContracts],
    query: {
      enabled: enabled && listedAddrs.length > 0,
      refetchInterval: POLL_MS,
    },
  });

  // Split the flat result back into the three logical groups.
  const n = listedAddrs.length;
  const balances = perAsset?.slice(0, n) ?? [];
  const decimals = perAsset?.slice(n, 2 * n) ?? [];
  const assetTuples = perAsset?.slice(2 * n, 3 * n) ?? [];

  // ── Adapter latestRoundData (one per listed asset) ────────────────────
  const adapterContracts = useMemo(() => {
    return assetTuples
      .map((r) => {
        if (r.status !== "success") return null;
        const tuple = r.result as readonly [Address, bigint, bigint, bigint, boolean];
        const addr = tuple[0];
        if (!addr || addr === "0x0000000000000000000000000000000000000000") return null;
        return addr;
      })
      .filter((a): a is Address => !!a)
      .map((a) => ({
        abi: PYTH_ADAPTER_ABI,
        address: a,
        functionName: "latestRoundData" as const,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      }));
  }, [assetTuples]);

  const { data: rounds } = useReadContracts({
    allowFailure: true,
    contracts: adapterContracts,
    query: {
      enabled: adapterContracts.length > 0,
      refetchInterval: POLL_MS,
    },
  });

  // ── Combine: TVL = USDG balance (normalized to 1e18) + Σ token × price ──
  const { collateralUsd, collateralByToken } = useMemo(() => {
    const byToken: Record<string, bigint> = {};
    if (!rounds || rounds.length === 0) return { collateralUsd: 0n, collateralByToken: byToken };
    let total = 0n;
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      const assetR = assetTuples[i];
      if (assetR?.status !== "success") continue;
      const tuple = assetR.result as readonly [Address, bigint, bigint, bigint, boolean];
      if (!tuple[0] || tuple[0] === "0x0000000000000000000000000000000000000000") continue;
      const balR = balances[i];
      const decR = decimals[i];
      if (balR?.status !== "success" || decR?.status !== "success") {
        cursor++;
        continue;
      }
      const bal = balR.result as bigint;
      const dec = Number(decR.result as number);
      const round = rounds[cursor++];
      if (!round || round.status !== "success") continue;
      const priceTuple = round.result as readonly [bigint, bigint, bigint, bigint, bigint];
      const price1e8 = priceTuple[1];
      if (price1e8 <= 0n) continue;
      const amountUsd = (bal * price1e8 * 10n ** 10n) / 10n ** BigInt(dec);
      total += amountUsd;
      const tokenAddr = listedAddrs[i];
      if (tokenAddr) byToken[tokenAddr.toLowerCase()] = amountUsd;
    }
    return { collateralUsd: total, collateralByToken: byToken };
  }, [rounds, assetTuples, balances, decimals, n, listedAddrs]);

  // Normalize USDG balance to 1e18 USD units.
  const liquidityUsd = useMemo(() => {
    if (usdgBalRaw == null) return null;
    if (usdgDecimals >= 18) {
      return usdgBalRaw * 10n ** BigInt(usdgDecimals - 18);
    }
    return usdgBalRaw * 10n ** BigInt(18 - usdgDecimals);
  }, [usdgBalRaw, usdgDecimals]);

  const tvlUsd =
    liquidityUsd != null ? liquidityUsd + collateralUsd : null;

  /// Utilization = borrowed / (borrowed + liquidity) — Aave-style. Some
  /// references use borrowed / liquidity which can exceed 100 %; we stick to
  /// the bounded form so the IRM curve stays meaningful.
  const utilizationBps =
    borrowedUsd != null && liquidityUsd != null && borrowedUsd + liquidityUsd > 0n
      ? Number(
          (borrowedUsd * 10_000n) / (borrowedUsd + liquidityUsd),
        )
      : null;
  const utilizationPct =
    utilizationBps != null ? utilizationBps / 100 : null;

  const derived = useMemo<DerivedRates | null>(() => {
    const util = onChainUtilBps ?? utilizationBps;
    if (util == null) return null;
    return deriveRates(util, reserveFactorBps);
  }, [onChainUtilBps, utilizationBps, reserveFactorBps]);

  // ── Liquidations (~24h window) ─────────────────────────────────────────
  const { data: head } = useBlockNumber({
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { refetchInterval: 30_000 },
  });
  const liquidations7d = useLiquidations(head, LIQ_WINDOW_BLOCKS, vaultAddr);

  return {
    tvlUsd,
    borrowedUsd,
    liquidityUsd,
    liquidationBonusBps,
    utilizationPct,
    assetCount: listedAddrs.length || null,
    liquidations7d,
    isLoading: !scalar || !perAsset,
    derived,
    collateralByToken,
  };
}

// ── Liquidation events via getLogs ────────────────────────────────────────
const LIQUIDATED_EVENT = parseAbiItem(
  "event Liquidated(address indexed user, address indexed liquidator, address indexed token, uint256 collateralSeized, uint256 debtRepaid)",
);

function useLiquidations(
  head: bigint | undefined,
  windowBlocks: bigint,
  vaultAddress?: Address,
): { count: number; totalDebtUsd: bigint } | null {
  const addr = vaultAddress ?? EQUIFLOW_VAULT_ADDRESS;
  const client = usePublicClient({ chainId: ROBINHOOD_CHAIN_TESTNET_ID });
  const fromBlock = head && head > windowBlocks ? head - windowBlocks : 0n;

  const { data } = useQuery({
    queryKey: [
      "equiflow",
      "liquidations",
      addr,
      head ? (head / 1200n).toString() : "0",
    ],
    queryFn: async () => {
      if (!client || !addr || !head) {
        return { count: 0, totalDebtUsd: 0n };
      }
      const logs = await getLogsChunked({
        client,
        address: addr,
        event: LIQUIDATED_EVENT,
        fromBlock,
        toBlock: head,
      });
      let total = 0n;
      for (const log of logs) {
        total += log.args.debtRepaid ?? 0n;
      }
      return { count: logs.length, totalDebtUsd: total };
    },
    enabled: !!client && !!addr && !!head,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  return data ?? null;
}

/** Convenience selector for the listedAssets() RPC: returns the array or [] */
export function useListedAssets(overrideVaultAddress?: Address): readonly Address[] {
  const vaultAddr = overrideVaultAddress ?? EQUIFLOW_VAULT_ADDRESS;
  const { data } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vaultAddr,
    functionName: "listedAssets",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!vaultAddr, staleTime: 60_000 },
  });
  return (data as readonly Address[] | undefined) ?? [];
}
