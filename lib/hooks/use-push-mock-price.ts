"use client";

import { useCallback } from "react";
import { useReadContract, useWriteContract } from "wagmi";
import type { Address, Hex } from "viem";
import {
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { PYTH_ADAPTER_ABI, craftMockPythUpdate } from "@/lib/web3/pyth";

/// Manually push a Pyth-format price update into the adapter for `symbol`.
/// Anyone can call this — Pyth adapters accept updates from any caller,
/// matching the real Pyth keeper model.
///
/// Useful for demo buttons ("force liquidation" etc). For the auto-running
/// production keeper see [use-price-keeper.ts](use-price-keeper.ts).
export function usePushMockPrice(symbol: string) {
  const tokenAddr = STOCK_TOKEN_ADDRESSES[symbol];

  const { data: asset } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS,
    functionName: "assets",
    args: tokenAddr ? [tokenAddr] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!EQUIFLOW_VAULT_ADDRESS && !!tokenAddr },
  });

  const adapterAddr = (asset as readonly [Address, ...unknown[]] | undefined)?.[0];

  const { data: adapterPriceId } = useReadContract({
    abi: PYTH_ADAPTER_ABI,
    address: adapterAddr,
    functionName: "priceId",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!adapterAddr, staleTime: Infinity },
  });

  const { writeContractAsync, isPending, error } = useWriteContract();

  const pushPrice = useCallback(
    async (usdPrice: number) => {
      if (process.env.NODE_ENV === "production") {
        throw new Error("usePushMockPrice is disabled in production");
      }
      if (!adapterAddr) throw new Error(`No adapter for ${symbol} — is the vault configured?`);
      if (!adapterPriceId) throw new Error(`priceId not yet loaded for ${symbol}`);
      const priceE8 = BigInt(Math.round(usdPrice * 1e8));
      const update = craftMockPythUpdate({
        priceId: adapterPriceId as Hex,
        price: priceE8,
        expo: -8,
      });
      return writeContractAsync({
        abi: PYTH_ADAPTER_ABI,
        address: adapterAddr,
        functionName: "updatePrice",
        args: [[update]],
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      });
    },
    [adapterAddr, adapterPriceId, symbol, writeContractAsync],
  );

  return {
    pushPrice,
    adapterAddr,
    isPending,
    error,
    ready: !!adapterAddr && !!adapterPriceId,
  };
}
