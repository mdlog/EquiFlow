"use client";

import { useMemo } from "react";
import { formatUnits } from "viem";
import { useReadContracts } from "wagmi";
import {
  ERC20_ABI,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { useActiveWallet } from "@/lib/hooks/use-active-wallet";

export function useStockBalance(sym: string) {
  // Active wallet address — smart account in AA mode so allowance + balance
  // checks line up with what the UserOp will actually present at the vault.
  const { address } = useActiveWallet();
  const token = STOCK_TOKEN_ADDRESSES[sym];

  const { data, isLoading, refetch } = useReadContracts({
    allowFailure: true,
    contracts: token
      ? ([
          {
            abi: ERC20_ABI,
            address: token,
            functionName: "balanceOf",
            args: [address ?? "0x0000000000000000000000000000000000000000"],
            chainId: ROBINHOOD_CHAIN_TESTNET_ID,
          },
          {
            abi: ERC20_ABI,
            address: token,
            functionName: "decimals",
            chainId: ROBINHOOD_CHAIN_TESTNET_ID,
          },
        ] as const)
      : [],
    query: {
      enabled: !!token && !!address,
      refetchInterval: 15_000,
    },
  });

  return useMemo(() => {
    if (!token) return { ready: false, configured: false } as const;
    if (!address) return { ready: false, configured: true } as const;
    const balRaw = data?.[0]?.result as bigint | undefined;
    const dec = (data?.[1]?.result as number | undefined) ?? 18;
    const formatted =
      balRaw !== undefined ? Number(formatUnits(balRaw, dec)) : 0;
    return {
      ready: !isLoading && balRaw !== undefined,
      configured: true,
      raw: balRaw,
      decimals: dec,
      formatted,
      refetch,
    } as const;
  }, [token, address, data, isLoading, refetch]);
}
