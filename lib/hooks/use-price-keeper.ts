"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReadContracts } from "wagmi";
import type { Address, Hex } from "viem";
import {
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { PYTH_ADAPTER_ABI } from "@/lib/web3/pyth";
import { STOCKS } from "@/lib/config/stocks";

/// Auto-keeper that periodically pushes Pyth Network price updates to each
/// asset's PythPriceAdapter.
///
/// Signing happens **server-side** at /api/keeper/tick using KEEPER_PRIVATE_KEY
/// (NO `NEXT_PUBLIC_` prefix). The browser only:
///   1. Discovers which symbols are live via public on-chain reads.
///   2. POSTs { symbol } to /api/keeper/tick on each tick.
///   3. Server fetches its own authoritative Pyth quote, resolves the adapter
///      from the vault, signs, and submits adapter.updatePrice([encodedBytes]).
///
/// Per tick the keeper rotates one symbol so concurrent tabs don't all collide
/// on the same nonce. If Hermes is unavailable the server refuses to sign
/// (503 hermes_unavailable) — there is no client-supplied fallback price.
///
/// `active` returns true once at least one adapter has been discovered AND the
/// server /api/keeper/tick endpoint responded with a non-503 in the last tick.

export interface PriceKeeperOptions {
  intervalMs?: number;
  verbose?: boolean;
}

interface PythQuote {
  price: string; // int64 as decimal string
  expo: number; // int32
  publishTime: number; // unix seconds
  activeSession?: "regular" | "pre" | "post" | "overnight";
}

/// Fetches the freshest session feed for `symbol`. Tries the multi-session
/// endpoint first (24/5 coverage via overnight/pre/post feeds); falls back to
/// the legacy single-feed endpoint if the symbol isn't multi-session wired.
async function fetchPythPrice(
  symbol: string,
  fallbackPriceId: Hex,
): Promise<PythQuote | null> {
  try {
    const bySym = await fetch(`/api/pyth/by-symbol/${symbol}`, {
      cache: "no-store",
    });
    if (bySym.ok) {
      const data = (await bySym.json()) as {
        price: string;
        expo: number;
        publishTime: number;
        activeSession: "regular" | "pre" | "post" | "overnight";
      };
      return {
        price: data.price,
        expo: data.expo,
        publishTime: data.publishTime,
        activeSession: data.activeSession,
      };
    }
    // 404 → symbol not multi-session, fall through.
  } catch {
    // network/parse error → fall through to legacy endpoint
  }

  try {
    const res = await fetch(`/api/pyth/${fallbackPriceId}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      price: string;
      expo: number;
      publishTime: number;
    };
    return {
      price: data.price,
      expo: data.expo,
      publishTime: data.publishTime,
    };
  } catch {
    return null;
  }
}

interface TickResponse {
  ok: boolean;
  txHash?: Hex;
  source?: "pyth" | "mock";
  price?: number;
  error?: string;
  detail?: string;
}

// The server resolves adapter + priceId + freshest Pyth quote itself from the
// symbol — caller-supplied prices are never trusted (see /api/keeper/tick).
async function postTick(payload: { symbol: string }): Promise<TickResponse> {
  try {
    const res = await fetch("/api/keeper/tick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as TickResponse;
    if (!res.ok) {
      return {
        ok: false,
        error: data.error ?? `http_${res.status}`,
        detail: data.detail,
      };
    }
    return data;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function usePriceKeeper({
  intervalMs = 12_000,
  verbose = false,
}: PriceKeeperOptions = {}): { active: boolean; signerAddress: Address | null } {
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);

  const liveSymbols = useMemo(
    () => STOCKS.filter((s) => s.liveOnRBN && !!STOCK_TOKEN_ADDRESSES[s.sym]),
    [],
  );

  // Pass 1: resolve adapter address for each symbol via vault.assets(token).
  const { data: assetReads } = useReadContracts({
    allowFailure: true,
    contracts: liveSymbols.map((s) => ({
      abi: EQUIFLOW_VAULT_ABI,
      address: EQUIFLOW_VAULT_ADDRESS,
      functionName: "assets" as const,
      args: [STOCK_TOKEN_ADDRESSES[s.sym]!] as const,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    })),
    query: {
      enabled: !!EQUIFLOW_VAULT_ADDRESS && liveSymbols.length > 0,
      staleTime: Infinity,
    },
  });

  const adapterAddrs = useMemo(() => {
    if (!assetReads) return [] as Array<Address | null>;
    return liveSymbols.map((_, i) => {
      const r = assetReads[i];
      if (r.status !== "success") return null;
      return (r.result as readonly [Address, ...unknown[]])[0];
    });
  }, [assetReads, liveSymbols]);

  // Pass 2: read each adapter's on-chain priceId.
  const validAddrs = useMemo(
    () => adapterAddrs.filter((a): a is Address => !!a),
    [adapterAddrs],
  );

  const { data: priceIdReads } = useReadContracts({
    allowFailure: true,
    contracts: validAddrs.map((addr) => ({
      abi: PYTH_ADAPTER_ABI,
      address: addr,
      functionName: "priceId" as const,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    })),
    query: {
      enabled: validAddrs.length > 0,
      staleTime: Infinity,
    },
  });

  const adapters = useMemo(() => {
    if (!priceIdReads)
      return [] as Array<{
        sym: string;
        addr: Address;
        priceId: Hex;
      }>;
    const out: Array<{
      sym: string;
      addr: Address;
      priceId: Hex;
    }> = [];
    let cursor = 0;
    for (let i = 0; i < liveSymbols.length; i++) {
      const addr = adapterAddrs[i];
      if (!addr) continue;
      const r = priceIdReads[cursor++];
      if (!r || r.status !== "success") continue;
      out.push({
        sym: liveSymbols[i].sym,
        addr,
        priceId: r.result as Hex,
      });
    }
    return out;
  }, [priceIdReads, adapterAddrs, liveSymbols]);

  const cursorRef = useRef(0);
  const inflightRef = useRef(false);

  useEffect(() => {
    if (adapters.length === 0) return;

    const tick = async () => {
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const a = adapters[cursorRef.current % adapters.length];
        cursorRef.current++;

        // fetchPythPrice runs only to surface activeSession in the verbose log
        // — the server fetches its own authoritative quote from Hermes.
        const quote = verbose ? await fetchPythPrice(a.sym, a.priceId) : null;

        const res = await postTick({ symbol: a.sym });

        if (res.ok) {
          setServerEnabled(true);
          if (verbose) {
            const session = quote?.activeSession ?? res.source;
            console.log(
              `[keeper:${res.source}:${session}] ${a.sym} → $${res.price?.toFixed(2)} (tx ${res.txHash?.slice(0, 10)}…)`,
            );
          }
        } else {
          if (res.error === "keeper_disabled") {
            setServerEnabled(false);
          }
          if (verbose) {
            console.warn(
              `[keeper] tick failed: ${res.error}${res.detail ? ` — ${res.detail}` : ""}`,
            );
          }
        }
      } finally {
        inflightRef.current = false;
      }
    };

    const initial = setTimeout(tick, 1_500);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [adapters, intervalMs, verbose]);

  return {
    active: serverEnabled === true && adapters.length > 0,
    signerAddress: null,
  };
}
