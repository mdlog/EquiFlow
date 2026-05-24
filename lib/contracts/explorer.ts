import type { Address } from "viem";

const EXPLORER_BASE = "https://explorer.testnet.chain.robinhood.com";

export function shortAddr(
  addr?: Address | string | null,
  head = 6,
  tail = 4,
) {
  if (!addr) return "";
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function explorerTx(hash: string) {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

export function explorerAddr(addr: string) {
  return `${EXPLORER_BASE}/address/${addr}`;
}
