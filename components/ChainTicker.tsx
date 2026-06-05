"use client";

import { useBlockNumber, useChainId } from "wagmi";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";

export function ChainTicker() {
  const chainId = useChainId();
  const { data: block } = useBlockNumber({
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    watch: true,
    query: { refetchInterval: 8_000 },
  });
  const onChain = chainId === ROBINHOOD_CHAIN_TESTNET_ID;
  const live = block !== undefined;

  return (
    // inline-flex + gap keeps the pill and the block readout from colliding
    // regardless of how the parent lays this out (desktop nav vs mobile menu).
    <span className="inline-flex items-center gap-2.5">
      <span className="flex items-center gap-2 border border-hairline-soft rounded-[2px] px-2.5 py-[5px]">
        <span
          className={`w-1.5 h-1.5 rounded-full ${live ? "bg-up live-dot" : "bg-ink-mute"}`}
          style={{
            animation: live ? "ef-breathe 2.2s ease-in-out infinite" : undefined,
          }}
        />
        <span
          className="font-mono whitespace-nowrap"
          style={{ fontSize: 11, letterSpacing: "0.04em" }}
        >
          RBN · Arbitrum L3{onChain ? "" : " · idle"}
        </span>
      </span>
      <span
        className="font-mono text-ink-mute tabular whitespace-nowrap"
        style={{ fontSize: 11 }}
      >
        {block !== undefined ? `Block ${block.toLocaleString("en-US")}` : "Block —"}
      </span>
    </span>
  );
}
