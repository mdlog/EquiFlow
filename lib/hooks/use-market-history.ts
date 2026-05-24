"use client";

import { useQuery } from "@tanstack/react-query";

/// Client hooks for the two history endpoints introduced alongside the markets
/// page revamp. Both return safe defaults (null change%, empty sparkline)
/// during loading / on failure so call-sites can keep their existing fallback
/// to STOCKS.changePct + seeded synthetic curves without extra branching.

export interface SymHistory24h {
  now: number | null;
  then: number | null;
  changePct: number | null;
  publishTimeNow: number | null;
  publishTimeThen: number | null;
}

export type History24hMap = Record<string, SymHistory24h>;

export function useMarkets24h(syms: string[]) {
  const key = [...syms].sort().join(",");
  return useQuery<History24hMap>({
    queryKey: ["markets-24h", key],
    enabled: syms.length > 0,
    // The endpoint itself is edge-cached for 60s — match that here so we don't
    // re-fetch on every tab focus / row hover.
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch(`/api/markets/24h?syms=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`http_${res.status}`);
      return (await res.json()) as History24hMap;
    },
  });
}

export interface SparklineResponse {
  enabled: boolean;
  series: Record<string, number[]>;
}

export function useMarketsSparkline(syms: string[], points = 24) {
  const key = [...syms].sort().join(",");
  return useQuery<SparklineResponse>({
    queryKey: ["markets-sparkline", key, points],
    enabled: syms.length > 0,
    // Keeper appends every few seconds, edge cache is 15s — match it.
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/markets/sparkline?syms=${encodeURIComponent(key)}&points=${points}`,
      );
      if (!res.ok) throw new Error(`http_${res.status}`);
      return (await res.json()) as SparklineResponse;
    },
  });
}
