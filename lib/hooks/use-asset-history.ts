"use client";

import { useQuery } from "@tanstack/react-query";

/// Hook over /api/markets/history/[sym]. Mirrors the TradingView shim shape
/// so the chart can consume bars directly without an intermediate mapping.

export type Resolution = "1" | "5" | "15" | "30" | "60" | "240" | "D";

export interface AssetHistory {
  s: "ok" | "no_data" | "error";
  t: number[]; // unix seconds, ascending
  o: number[];
  h: number[];
  l: number[];
  c: number[];
}

export interface AssetHistoryParams {
  symbol: string;
  days?: number;
  resolution?: Resolution;
}

export function useAssetHistory({
  symbol,
  days = 7,
  resolution = "60",
}: AssetHistoryParams) {
  return useQuery<AssetHistory>({
    queryKey: ["asset-history", symbol.toUpperCase(), days, resolution],
    enabled: !!symbol,
    // Mirror the route's 60s edge cache so window focus does not re-fetch.
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/markets/history/${encodeURIComponent(symbol.toUpperCase())}` +
          `?days=${days}&resolution=${resolution}`,
      );
      if (!res.ok && res.status !== 502) throw new Error(`http_${res.status}`);
      const data = (await res.json()) as Partial<AssetHistory>;
      return {
        s: data.s ?? "no_data",
        t: data.t ?? [],
        o: data.o ?? [],
        h: data.h ?? [],
        l: data.l ?? [],
        c: data.c ?? [],
      };
    },
  });
}
