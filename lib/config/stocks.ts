import { STOCK_TOKEN_ADDRESSES } from "@/lib/contracts";

export type Stock = {
  sym: string;
  name: string;
  sector: string;
  /** Reference price (USD). Used only as a last-resort UI fallback when the
   *  on-chain Pyth adapter is unreachable. Real price comes from
   *  `useStockPrice()` or `useStockPrices()` in `use-adapter-price.ts`. */
  price: number;
  /** Per-asset maximum borrow LTV (decimal, e.g. 0.72 = 72%).
   *  Overridden by on-chain `vault.assets(token).ltvBps` when available. */
  ltv: number;
  /** Annualised realised volatility (decimal). Used for animation timing and
   *  keeper mock-walk amplitude. Config parameter, not live financial data. */
  volatility: number;
  /** true if the Robinhood Chain testnet ships a Stock Token for this symbol */
  liveOnRBN: boolean;
};

const BASE: Stock[] = [
  // ── LIVE on Robinhood Chain testnet (faucet-issued Stock Tokens) ─────────
  {
    sym: "TSLA",
    name: "Tesla, Inc.",
    sector: "Auto · EV",
    price: 348.51,
    ltv: 0.55,
    volatility: 0.52,
    liveOnRBN: true,
  },
  {
    sym: "AMZN",
    name: "Amazon.com, Inc.",
    sector: "E-commerce · Cloud",
    price: 232.18,
    ltv: 0.7,
    volatility: 0.21,
    liveOnRBN: true,
  },
  {
    sym: "PLTR",
    name: "Palantir Technologies",
    sector: "Data · AI",
    price: 156.04,
    ltv: 0.5,
    volatility: 0.48,
    liveOnRBN: true,
  },
  {
    sym: "NFLX",
    name: "Netflix, Inc.",
    sector: "Streaming",
    price: 821.45,
    ltv: 0.62,
    volatility: 0.27,
    liveOnRBN: true,
  },
  {
    sym: "AMD",
    name: "Advanced Micro Devices",
    sector: "Semiconductors",
    price: 198.62,
    ltv: 0.6,
    volatility: 0.38,
    liveOnRBN: true,
  },
  // ── Reference assets (oracle-priced display only on testnet) ─────────────
  {
    sym: "AAPL",
    name: "Apple Inc.",
    sector: "Technology",
    price: 217.84,
    ltv: 0.72,
    volatility: 0.18,
    liveOnRBN: false,
  },
  {
    sym: "NVDA",
    name: "NVIDIA Corp.",
    sector: "Semiconductors",
    price: 135.40,
    ltv: 0.65,
    volatility: 0.34,
    liveOnRBN: false,
  },
  {
    sym: "SPY",
    name: "SPDR S&P 500 ETF",
    sector: "Broad ETF",
    price: 612.07,
    ltv: 0.85,
    volatility: 0.06,
    liveOnRBN: false,
  },
];

export const STOCKS: Stock[] = BASE;

export const findStock = (sym: string): Stock =>
  STOCKS.find((s) => s.sym === sym) ?? STOCKS[0];

export const stockAddress = (sym: string) => STOCK_TOKEN_ADDRESSES[sym];

export const isLive = (sym: string) =>
  findStock(sym).liveOnRBN && !!STOCK_TOKEN_ADDRESSES[sym];
