"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import {
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { PYTH_ADAPTER_ABI } from "@/lib/web3/pyth";
import { STOCKS, findStock } from "@/lib/config/stocks";

export interface AdapterPrice {
  /** Decimal USD price (e.g. 348.51). Null while loading / unconfigured. */
  price: number | null;
  /** Last observation timestamp (unix seconds). 0 if unknown. */
  updatedAt: number;
  /** Resolved adapter address, null if vault/token not configured. */
  adapterAddr: Address | null;
  /** Max-borrow LTV in basis points (e.g. 7200 = 72%). Null if asset not listed. */
  ltvBps: number | null;
  /** Liquidation threshold in basis points (e.g. 7800 = 78%). Null if not listed. */
  liqThresholdBps: number | null;
  isLoading: boolean;
}

const POLL_MS = 5_000;
const ALL_SYMS = STOCKS.map((s) => s.sym).sort().join(",");

// ── Pyth Hermes prices (off-chain, all symbols) ────────────────────────────
// Fetches current prices from Pyth Hermes via /api/markets/24h for ALL known
// symbols. This covers assets without on-chain adapters (AAPL, NVDA, SPY).
// Cached for 60s — same as the endpoint's edge cache.
function useHermesPrices(): Record<string, number> {
  const { data } = useQuery<Record<string, { now: number | null }>>({
    queryKey: ["hermes-prices", ALL_SYMS],
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/markets/24h?syms=${encodeURIComponent(ALL_SYMS)}&parsed=true`,
      );
      if (!res.ok) return {};
      return (await res.json()) as Record<string, { now: number | null }>;
    },
  });
  return useMemo(() => {
    const out: Record<string, number> = {};
    if (!data) return out;
    for (const [sym, h] of Object.entries(data)) {
      if (h.now != null) out[sym] = h.now;
    }
    return out;
  }, [data]);
}

// ── On-chain adapter price (single symbol) ──────────────────────────────────
export function useAdapterPrice(symbol: string): AdapterPrice {
  const tokenAddr = STOCK_TOKEN_ADDRESSES[symbol];

  const { data: asset, isLoading: assetLoading } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS,
    functionName: "assets",
    args: tokenAddr ? [tokenAddr] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: {
      enabled: !!EQUIFLOW_VAULT_ADDRESS && !!tokenAddr,
      staleTime: 60_000,
    },
  });

  const assetTuple = asset as
    | readonly [Address, bigint, bigint, bigint, boolean]
    | undefined;
  const adapterAddr = assetTuple?.[0] ?? null;
  const ltvBps = assetTuple ? Number(assetTuple[1]) : null;
  const liqThresholdBps = assetTuple ? Number(assetTuple[2]) : null;
  const adapterValid = adapterAddr && adapterAddr !== ("0x0000000000000000000000000000000000000000" as Address);

  const { data: roundData, isLoading: priceLoading } = useReadContract({
    abi: PYTH_ADAPTER_ABI,
    address: adapterValid ? adapterAddr : undefined,
    functionName: "latestRoundData",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: {
      enabled: !!adapterValid,
      refetchInterval: POLL_MS,
    },
  });

  if (!roundData || !adapterValid) {
    return {
      price: null,
      updatedAt: 0,
      adapterAddr: adapterAddr,
      ltvBps,
      liqThresholdBps,
      isLoading: assetLoading || priceLoading,
    };
  }

  const [, answer, , updatedAt] = roundData as readonly [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  return {
    price: Number(answer) / 1e8,
    updatedAt: Number(updatedAt),
    adapterAddr,
    ltvBps,
    liqThresholdBps,
    isLoading: false,
  };
}

/// Price fallback chain: on-chain adapter > Pyth Hermes > static reference.
export function useStockPrice(symbol: string): {
  price: number;
  ltv: number;
  liqThreshold: number;
  isLive: boolean;
  ltvIsLive: boolean;
  updatedAt: number;
} {
  const onchain = useAdapterPrice(symbol);
  const hermes = useHermesPrices();
  const fallback = findStock(symbol);
  const hermesPrice = hermes[symbol];
  return {
    price: onchain.price ?? hermesPrice ?? fallback.price,
    ltv: onchain.ltvBps != null ? onchain.ltvBps / 10_000 : fallback.ltv,
    // On-chain from vault.assets(token).liqThresholdBps when listed;
    // estimate LTV + 8pp for display-only assets not listed in the vault.
    liqThreshold:
      onchain.liqThresholdBps != null
        ? onchain.liqThresholdBps / 10_000
        : fallback.ltv + 0.08,
    isLive: onchain.price !== null || hermesPrice !== undefined,
    ltvIsLive: onchain.ltvBps != null,
    updatedAt: onchain.updatedAt,
  };
}

/// Drop-in replacement for `useLiveTick` that sources the price from the
/// on-chain adapter (or Hermes fallback). Returns the same
/// `{ value, formatted, dir }` shape so UI animation code keeps working.
export function useLiveAdapterTick(
  symbol: string,
  format: (v: number) => string = (v) => v.toFixed(2),
): { value: number; formatted: string; dir: -1 | 0 | 1; isLive: boolean } {
  const { price, isLive } = useStockPrice(symbol);
  const prevRef = useRef<number>(price);
  const [dir, setDir] = useState<-1 | 0 | 1>(0);

  useEffect(() => {
    const prev = prevRef.current;
    if (price > prev + 0.0001) setDir(1);
    else if (price < prev - 0.0001) setDir(-1);
    prevRef.current = price;
  }, [price]);

  return {
    value: price,
    formatted: format(price),
    dir,
    isLive,
  };
}

/// Batched read of every symbol's price. Priority: on-chain adapter > Pyth
/// Hermes > static reference. High-density UIs (marquee, markets table) use
/// this instead of per-symbol hooks.
export function useStockPrices(): Record<string, { price: number; isLive: boolean; updatedAt: number }> {
  const hermes = useHermesPrices();

  const liveTokens = useMemo(
    () =>
      STOCKS
        .map((s) => ({ sym: s.sym, addr: STOCK_TOKEN_ADDRESSES[s.sym], fallback: s.price }))
        .filter((t): t is { sym: string; addr: Address; fallback: number } => !!t.addr),
    [],
  );

  const { data: assets } = useReadContracts({
    allowFailure: true,
    contracts: liveTokens.map((t) => ({
      abi: EQUIFLOW_VAULT_ABI,
      address: EQUIFLOW_VAULT_ADDRESS,
      functionName: "assets" as const,
      args: [t.addr] as const,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    })),
    query: {
      enabled: !!EQUIFLOW_VAULT_ADDRESS && liveTokens.length > 0,
      staleTime: 60_000,
    },
  });

  const adapters = useMemo(() => {
    if (!assets) return [] as Array<{ sym: string; addr: Address | null; fallback: number }>;
    return liveTokens.map((t, i) => {
      const r = assets[i];
      const addr =
        r.status === "success"
          ? ((r.result as readonly [Address, ...unknown[]])[0] as Address)
          : null;
      return { sym: t.sym, addr, fallback: t.fallback };
    });
  }, [assets, liveTokens]);

  const { data: rounds } = useReadContracts({
    allowFailure: true,
    contracts: adapters
      .filter((a) => a.addr)
      .map((a) => ({
        abi: PYTH_ADAPTER_ABI,
        address: a.addr!,
        functionName: "latestRoundData" as const,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      })),
    query: {
      enabled: adapters.some((a) => a.addr),
      refetchInterval: POLL_MS,
    },
  });

  return useMemo(() => {
    const out: Record<string, { price: number; isLive: boolean; updatedAt: number }> = {};
    // Seed: static fallback for all symbols
    for (const s of STOCKS) {
      out[s.sym] = { price: s.price, isLive: false, updatedAt: 0 };
    }
    // Layer 1: Pyth Hermes (off-chain) — covers ALL symbols including
    // those without on-chain adapters (AAPL, NVDA, SPY)
    for (const s of STOCKS) {
      if (hermes[s.sym] != null) {
        out[s.sym] = { price: hermes[s.sym], isLive: true, updatedAt: 0 };
      }
    }
    // Layer 2: on-chain adapter — highest priority, overwrites Hermes
    if (rounds) {
      let cursor = 0;
      for (const a of adapters) {
        if (!a.addr) continue;
        const r = rounds[cursor++];
        if (r.status !== "success") continue;
        const tuple = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
        out[a.sym] = {
          price: Number(tuple[1]) / 1e8,
          isLive: true,
          updatedAt: Number(tuple[3]),
        };
      }
    }
    return out;
  }, [adapters, rounds, hermes]);
}
