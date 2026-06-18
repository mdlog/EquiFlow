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
import { MARKET_OPEN_FRESH_SEC } from "@/lib/web3/market-hours";

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

// ── Pyth live prices (off-chain, all symbols, freshest of equity + xStock) ──
// Fetches from /api/markets/live, which returns the freshest of each symbol's
// equity feed and (when available) its 24/7 xStock feed. Covers assets without
// on-chain adapters AND keeps xStock-covered tickers live off-hours. Polled
// every 5s for a real-time-ish cadence.
interface LiveQuote {
  price: number;
  publishTime: number; // unix seconds — true data age (not the keeper stamp)
  source: "xstock" | "equity";
}

function useLivePrices(): Record<string, LiveQuote> {
  const { data } = useQuery<
    Record<string, { price: number | null; publishTime: number | null; source: string | null }>
  >({
    queryKey: ["live-prices", ALL_SYMS],
    staleTime: 5_000,
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch(`/api/markets/live?syms=${encodeURIComponent(ALL_SYMS)}`);
      if (!res.ok) return {};
      return (await res.json()) as Record<
        string,
        { price: number | null; publishTime: number | null; source: string | null }
      >;
    },
  });
  return useMemo(() => {
    const out: Record<string, LiveQuote> = {};
    if (!data) return out;
    for (const [sym, q] of Object.entries(data)) {
      if (q.price != null && q.publishTime != null && q.source) {
        out[sym] = {
          price: q.price,
          publishTime: q.publishTime,
          source: q.source === "xstock" ? "xstock" : "equity",
        };
      }
    }
    return out;
  }, [data]);
}

/// A Hermes quote is "live" when its publish_time is within the market-open
/// freshness window. xStock feeds publish 24/7 so they stay live; equity feeds
/// only pass this during 09:30–16:00 ET (else the market is closed).
function isLiveFresh(publishTimeSec: number): boolean {
  return Math.floor(Date.now() / 1000) - publishTimeSec <= MARKET_OPEN_FRESH_SEC;
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

/// Where the currently displayed price comes from:
///   - "xstock"  live 24/7 Pyth xStock feed (tokenized equity)
///   - "equity"  live Pyth equity feed (NYSE regular hours)
///   - "closed"  market shut — showing the last on-chain/equity close
///   - "static"  no live data — static seed (dev sim / unconfigured)
export type PriceSource = "xstock" | "equity" | "closed" | "static";

/// UI label + accent colour for a price source. Single source of truth so the
/// markets table, asset detail, and SessionBadge stay consistent.
export function priceSourceMeta(source: PriceSource): { label: string; color: string } {
  switch (source) {
    case "xstock":
      return { label: "Pyth · xStock 24/7", color: "var(--up)" };
    case "equity":
      return { label: "Pyth · NYSE live", color: "var(--up)" };
    case "closed":
      return { label: "NYSE · last close", color: "var(--amber)" };
    default:
      return { label: "Off-chain · sim", color: "var(--ink-mute)" };
  }
}

/// Display price resolution: a FRESH Hermes quote (xStock 24/7, or live equity
/// during regular hours) wins so the UI shows live prices even when the on-chain
/// adapter holds a frozen last-close off-hours. Falls back to the on-chain close,
/// then the static seed. LTV / liq-threshold ALWAYS come from on-chain (they
/// drive the lending UI) — never from the display price — so health-factor logic
/// is untouched.
export function useStockPrice(symbol: string): {
  price: number;
  ltv: number;
  liqThreshold: number;
  isLive: boolean;
  ltvIsLive: boolean;
  updatedAt: number;
  source: PriceSource;
} {
  const onchain = useAdapterPrice(symbol);
  const live = useLivePrices();
  const fallback = findStock(symbol);
  const q = live[symbol];
  const liveFresh = q ? isLiveFresh(q.publishTime) : false;
  const source: PriceSource = liveFresh
    ? q!.source === "xstock"
      ? "xstock"
      : "equity"
    : onchain.price !== null || q
      ? "closed"
      : "static";
  return {
    price: liveFresh ? q!.price : onchain.price ?? q?.price ?? fallback.price,
    ltv: onchain.ltvBps != null ? onchain.ltvBps / 10_000 : fallback.ltv,
    // On-chain from vault.assets(token).liqThresholdBps when listed;
    // estimate LTV + 8pp for display-only assets not listed in the vault.
    liqThreshold:
      onchain.liqThresholdBps != null
        ? onchain.liqThresholdBps / 10_000
        : fallback.ltv + 0.08,
    isLive: liveFresh || onchain.price !== null,
    ltvIsLive: onchain.ltvBps != null,
    // Prefer the Hermes publish_time (true data age) so freshness badges read
    // correctly; fall back to the on-chain stamp when no Hermes quote exists.
    updatedAt: q ? q.publishTime : onchain.updatedAt,
    source,
  };
}

/// Drop-in replacement for `useLiveTick` that sources the price from the
/// on-chain adapter (or Hermes fallback). Returns the same
/// `{ value, formatted, dir }` shape so UI animation code keeps working.
export function useLiveAdapterTick(
  symbol: string,
  format: (v: number) => string = (v) => v.toFixed(2),
): { value: number; formatted: string; dir: -1 | 0 | 1; isLive: boolean; source: PriceSource } {
  const { price, isLive, source } = useStockPrice(symbol);
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
    source,
  };
}

/// Batched read of every symbol's price. Priority: on-chain adapter > Pyth
/// Hermes > static reference. High-density UIs (marquee, markets table) use
/// this instead of per-symbol hooks.
export function useStockPrices(): Record<string, { price: number; isLive: boolean; updatedAt: number }> {
  const live = useLivePrices();

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

    // On-chain adapter values (last close; updatedAt is the keeper stamp).
    const onchainBySym: Record<string, { price: number; updatedAt: number }> = {};
    if (rounds) {
      let cursor = 0;
      for (const a of adapters) {
        if (!a.addr) continue;
        const r = rounds[cursor++];
        if (r.status !== "success") continue;
        const tuple = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
        onchainBySym[a.sym] = {
          price: Number(tuple[1]) / 1e8,
          updatedAt: Number(tuple[3]),
        };
      }
    }

    // Priority per symbol: fresh Hermes (xStock 24/7 or live equity) > on-chain
    // last close > stale Hermes > static seed.
    for (const s of STOCKS) {
      const q = live[s.sym];
      const oc = onchainBySym[s.sym];
      const liveFresh = q ? isLiveFresh(q.publishTime) : false;
      if (liveFresh) {
        out[s.sym] = { price: q!.price, isLive: true, updatedAt: q!.publishTime };
      } else if (oc) {
        // Market closed & no live feed — on-chain last close. updatedAt uses the
        // Hermes publish_time (real data age) when available so the row can show
        // a "closed" state instead of a misleadingly fresh keeper stamp.
        out[s.sym] = {
          price: oc.price,
          isLive: false,
          updatedAt: q ? q.publishTime : oc.updatedAt,
        };
      } else if (q) {
        out[s.sym] = { price: q.price, isLive: false, updatedAt: q.publishTime };
      } else {
        out[s.sym] = { price: s.price, isLive: false, updatedAt: 0 };
      }
    }
    return out;
  }, [adapters, rounds, live]);
}
