import { type Address, type Hex, encodeAbiParameters } from "viem";

/// ─── Pyth Network — US Equity Feeds (regular hours) ───────────────────────
/// Source: hermes.pyth.network/v2/price_feeds?asset_type=equity
///
/// On RBN we run MockPyth (Pyth not deployed there). On Arbitrum Sepolia the
/// real Pyth contract lives at 0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF.
///
/// NOTE: Pyth also published per-session feeds (PRE/POST/OVERNIGHT) for these
/// tickers but DEPRECATED them ~2026-06 (they stopped publishing; Hermes still
/// serves a >40h-stale last value). EquiFlow now uses ONLY the regular feed
/// below — see the PythSession note further down.

export const PYTH_PRICE_IDS: Record<string, Hex> = {
  TSLA: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  AMZN: "0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a",
  PLTR: "0x11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0",
  NFLX: "0x8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2",
  AMD: "0x3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e",
  AAPL: "0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  NVDA: "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  GOOGL: "0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6",
  MSFT: "0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
  META: "0x78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe",
  SPY: "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
};

/// Returns the Pyth priceId for a ticker (defaults to regular session).
export function priceIdFor(symbol: string): Hex | undefined {
  return PYTH_PRICE_IDS[symbol.toUpperCase()];
}

/// ─── Pyth Network — xStock (Backed tokenized equities) 24/7 feeds ──────────
/// `Crypto.<TICKER>X/USD` feeds track the tokenized version of the stock and
/// publish 24/7 (sub-second even pre/post-market and weekends), unlike the
/// `Equity.US.<TICKER>/USD` feeds which freeze outside 09:30–16:00 ET. EquiFlow
/// uses these for LIVE off-hours DISPLAY pricing only. Coverage is partial —
/// only the tickers below have an xStock feed; the rest fall back to the equity
/// feed (live in regular hours, last close off-hours). On-chain adapters + the
/// keeper are unchanged and still use the regular equity priceId.
export const PYTH_XSTOCK_IDS: Record<string, Hex> = {
  TSLA:  "0x47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362",
  NFLX:  "0x02a67e6184e6c9dd65e14745a2a80df8b2b3d2ca91b4b191404936003d9929ae",
  AAPL:  "0x978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675",
  NVDA:  "0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f",
  GOOGL: "0xb911b0329028cd0283e4259c33809d62942bd2716a58084e5f31d64c00b5424e",
  META:  "0xbf3e5871be3f80ab7a4d1f1fd039145179fb58569e159aee1ccd472868ea5900",
  SPY:   "0x2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14",
};

/// Returns the xStock (24/7) priceId for a ticker, or undefined if none exists.
export function xStockIdFor(symbol: string): Hex | undefined {
  return PYTH_XSTOCK_IDS[symbol.toUpperCase()];
}

/// Pyth session identifier — retained as a stable union for the
/// /api/pyth/by-symbol response and the SessionBadge UI.
///
/// HISTORY: Pyth used to publish 4 feeds per US-equity ticker (regular / pre /
/// post / overnight) for 24/5 coverage. As of ~2026-06 the pre/post/overnight
/// equity feeds were DEPRECATED and stopped publishing — only the regular
/// `Equity.US.<TICKER>/USD` feed (PYTH_PRICE_IDS above) stays live, 09:30–16:00
/// ET. EquiFlow therefore sources every price from the regular feed; during
/// off-hours the keeper holds the last close via its allowStale path. In
/// practice only "regular" is ever the active session.
export type PythSession = "regular" | "pre" | "post" | "overnight";

/// ─── PythPriceAdapter ABI ─────────────────────────────────────────────────
export const PYTH_ADAPTER_ABI = [
  {
    type: "function",
    name: "updatePrice",
    stateMutability: "payable",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [],
  },
  // H-02 fix (audit pass 2): keeper escape hatch when the deviation cap would
  // otherwise reject every update during a legitimate gap move. Callable once
  // the cached price is older than `DEVIATION_OVERRIDE_DELAY` (30 min).
  {
    type: "function",
    name: "forceUpdatePrice",
    stateMutability: "payable",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [],
  },
  // Read the current per-update deviation ceiling (bps). Used by the keeper
  // to decide between `updatePrice` and `forceUpdatePrice` paths.
  {
    type: "function",
    name: "maxDeviationBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "priceId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "pyth",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "confidence",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "exponent",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "int32" }],
  },
  {
    type: "event",
    name: "PriceUpdated",
    inputs: [
      { name: "priceE8", type: "int256", indexed: false },
      { name: "publishTime", type: "uint64", indexed: false },
      { name: "expo", type: "int32", indexed: false },
      { name: "round", type: "uint80", indexed: false },
    ],
    anonymous: false,
  },
] as const;

/// ─── MockPyth-compatible update payload ───────────────────────────────────
/// On RBN our adapter is wired to MockPyth, which decodes each updateData[i]
/// as `abi.encode(PriceFeed)` — NOT as a Wormhole VAA. So when the keeper
/// receives a real Pyth report from Hermes, it can either:
///   (a) pass the raw VAA bytes through (works only on real Pyth contract)
///   (b) re-encode into MockPyth's expected shape (works on RBN MockPyth)
///
/// We use (b): server parses Hermes JSON for `mid`/`expo`/`publishTime`,
/// keeper crafts a fresh `PriceFeed` blob and pushes. The values stay real
/// (Pyth DON consensus), the verification is mocked (no Wormhole on RBN).

export interface CraftMockPythUpdateArgs {
  priceId: Hex;
  /** Raw Pyth price (int64). */
  price: bigint;
  /** Pyth exponent (int32). Varies per feed — e.g. TSLA is -5, others -8.
   *  Always pass the REAL Hermes expo; the adapter normalizes to 1e8 via
   *  _toE8 (and confidence via _confToE8), so a hardcoded -8 would mis-scale. */
  expo: number;
  /** Publish time in unix seconds. Default now. */
  publishTime?: number;
  /** Confidence interval (uint64). Default 0. */
  conf?: bigint;
}

const PRICE_TUPLE = [
  { name: "price", type: "int64" },
  { name: "conf", type: "uint64" },
  { name: "expo", type: "int32" },
  { name: "publishTime", type: "uint256" },
] as const;

const PRICE_FEED_TUPLE = [
  { name: "id", type: "bytes32" },
  { name: "price", type: "tuple", components: PRICE_TUPLE },
  { name: "emaPrice", type: "tuple", components: PRICE_TUPLE },
] as const;

export function craftMockPythUpdate({
  priceId,
  price,
  expo,
  publishTime,
  conf = 0n,
}: CraftMockPythUpdateArgs): Hex {
  const t = publishTime ?? Math.floor(Date.now() / 1000);
  const priceStruct = { price, conf, expo, publishTime: BigInt(t) };
  return encodeAbiParameters(
    [{ type: "tuple", components: PRICE_FEED_TUPLE }],
    [
      {
        id: priceId,
        price: priceStruct,
        emaPrice: priceStruct,
      },
    ],
  );
}

/// ─── Env-driven addresses ────────────────────────────────────────────────
function cleanAddr(v: string | undefined): Address | undefined {
  if (!v || !v.startsWith("0x") || v.length !== 42) return undefined;
  return v as Address;
}

export const PYTH_ADDRESS = cleanAddr(process.env.NEXT_PUBLIC_PYTH_ADDRESS);

/// Known Pyth contract addresses. RBN runs MockPyth deployed by the script.
export const PYTH_BY_CHAIN: Record<number, Address> = {
  421614: "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF", // Arbitrum Sepolia
  42161: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C", // Arbitrum One
};

export const PYTH_HERMES_URL = "https://hermes.pyth.network";
