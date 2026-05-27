import type { Address } from "viem";

/// Env-driven contract addresses (NEXT_PUBLIC_*).
///
/// IMPORTANT: each `process.env.NEXT_PUBLIC_*` access must be statically
/// written out. Next.js only inlines NEXT_PUBLIC_ vars into the client bundle
/// when the key is a literal — `process.env[k]` with a computed key stays
/// undefined on the client, causing SSR/CSR hydration mismatches.

function clean(v: string | undefined): Address | undefined {
  if (!v || !v.startsWith("0x") || v.length !== 42) return undefined;
  return v as Address;
}

export const STOCK_TOKEN_ADDRESSES: Record<string, Address | undefined> = {
  TSLA: clean(process.env.NEXT_PUBLIC_TOKEN_TSLA),
  AMZN: clean(process.env.NEXT_PUBLIC_TOKEN_AMZN),
  PLTR: clean(process.env.NEXT_PUBLIC_TOKEN_PLTR),
  NFLX: clean(process.env.NEXT_PUBLIC_TOKEN_NFLX),
  AMD: clean(process.env.NEXT_PUBLIC_TOKEN_AMD),
  AAPL: clean(process.env.NEXT_PUBLIC_TOKEN_AAPL),
  NVDA: clean(process.env.NEXT_PUBLIC_TOKEN_NVDA),
  MSFT: clean(process.env.NEXT_PUBLIC_TOKEN_MSFT),
  GOOGL: clean(process.env.NEXT_PUBLIC_TOKEN_GOOGL),
  SPY: clean(process.env.NEXT_PUBLIC_TOKEN_SPY),
  QQQ: clean(process.env.NEXT_PUBLIC_TOKEN_QQQ),
};

export const EQUIFLOW_VAULT_ADDRESS = clean(
  process.env.NEXT_PUBLIC_VAULT_ADDRESS,
);
export const USDC_ADDRESS = clean(process.env.NEXT_PUBLIC_USDC_ADDRESS);

export const WETH_VAULT_ADDRESS = clean(
  process.env.NEXT_PUBLIC_WETH_VAULT_ADDRESS,
);
export const WETH_ADDRESS = clean(process.env.NEXT_PUBLIC_WETH_ADDRESS);
