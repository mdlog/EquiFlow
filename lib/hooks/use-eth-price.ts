"use client";

import { useQuery } from "@tanstack/react-query";

const ETH_USD_PYTH_ID =
  "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

const HERMES = "https://hermes.pyth.network";

export function useEthPrice(): { price: number | null; isLoading: boolean } {
  const { data, isLoading } = useQuery<number | null>({
    queryKey: ["eth-usd-price"],
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const url = `${HERMES}/v2/updates/price/latest?ids[]=${ETH_USD_PYTH_ID}&parsed=true`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        parsed: Array<{
          price: { price: string; expo: number };
        }>;
      };
      const feed = data.parsed?.[0];
      if (!feed) return null;
      const raw = Number(feed.price.price);
      const expo = feed.price.expo;
      return raw * 10 ** expo;
    },
  });

  return { price: data ?? null, isLoading };
}
