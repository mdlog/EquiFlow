import { type Address, type Hex, encodeAbiParameters } from "viem";

/// ─── Pyth Network — US Equity Feeds (regular hours) ───────────────────────
/// Source: hermes.pyth.network/v2/price_feeds?asset_type=equity
///
/// On RBN we run MockPyth (Pyth not deployed there). On Arbitrum Sepolia the
/// real Pyth contract lives at 0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF.
///
/// Each ticker also has separate priceIds for "POST MARKET", "PRE MARKET",
/// "OVERNIGHT HOURS" sessions — query Hermes for the full table if needed.

export type StreamSession = "regular" | "extended" | "overnight";

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

/// US equity tickers publish on 4 separate Pyth feeds covering 24/5:
///   - regular   09:30–16:00 ET (Mon-Fri)
///   - pre       04:00–09:30 ET
///   - post      16:00–20:00 ET
///   - overnight 20:00–04:00 ET (& weekend gap)
///
/// EquiFlow adapters are deployed against the REGULAR priceId. Because the
/// on-chain Pyth oracle on RBN is MockPyth (verbatim, no Wormhole sig check),
/// the keeper can transparently substitute the freshest session's price into
/// a payload tagged with the adapter's registered (regular) priceId. The
/// adapter caches it without complaint.
///
/// For mainnet deployment against real Pyth this trick wouldn't work — each
/// session would need its own adapter contract, and the vault would route to
/// the active one (or deploy 4 adapters + a session-router contract).
export type PythSession = "regular" | "pre" | "post" | "overnight";

export const PYTH_PRICE_IDS_BY_SESSION: Record<string, Record<PythSession, Hex>> = {
  TSLA: {
    regular:   "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    pre:       "0x42676a595d0099c381687124805c8bb22c75424dffcaa55e3dc6549854ebe20a",
    post:      "0x2a797e196973b72447e0ab8e841d9f5706c37dc581fe66a0bd21bcd256cdb9b9",
    overnight: "0x713631e41c06db404e6a5d029f3eebfd5b885c59dce4a19f337c024e26584e26",
  },
  AMZN: {
    regular:   "0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a",
    pre:       "0x82c59e36a8e0247e15283748d6cd51f5fa1019d73fbf3ab6d927e17d9e357a7f",
    post:      "0x62731dfcc8b8542e52753f208248c3e73fab2ec15422d6f65c2decda71ccea0d",
    overnight: "0x4ec1330b56eca05037c6b5a51d05f73db79bf3b4d29899881acd27966af184b4",
  },
  PLTR: {
    regular:   "0x11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0",
    pre:       "0xbd8a8e449278ad0b6512695b1c558f816309f045d4e3da21dfc19448281840e8",
    post:      "0xb11610f59456057d9bc82b0795c6d7aea6e2e075fc3e1991abc05e2b2861abb2",
    overnight: "0x3a4c922ec7e8cd86a6fa4005827e723a134a16f4ffe836eac91e7820c61f75a1",
  },
  NFLX: {
    regular:   "0x8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2",
    pre:       "0x81a3f7f89a88e9a0279b705f5a6670ad6d3702b9a7d3741423233a85d6758bab",
    post:      "0xf3ae7810a11854aed92499250f89edd22409075dce2c17305fc33653522424c6",
    overnight: "0xa68f6030142bf1370f0963cd2d33b8aef33e4777a0331a63b383b88b2fd92dd7",
  },
  AMD: {
    regular:   "0x3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e",
    pre:       "0x441bc31e56932a8764a3bdb90059ca540e41c669dc0641e38b57b5e0606301ed",
    post:      "0x6969003ef4c5fbb3b57a6be3883102362d05572c2dc7f72b767ad48f4206204b",
    overnight: "0x7178689d88cdd76574b64438fc57f4e57efaf0bf5f9593ee19c10e46a3c5b5cf",
  },
};

/// Returns all 4 session priceIds for a symbol, or undefined if not multi-session.
export function sessionPriceIdsFor(symbol: string): Record<PythSession, Hex> | undefined {
  return PYTH_PRICE_IDS_BY_SESSION[symbol.toUpperCase()];
}

/// ─── PythPriceAdapter ABI ─────────────────────────────────────────────────
export const PYTH_ADAPTER_ABI = [
  {
    type: "function",
    name: "updatePrice",
    stateMutability: "payable",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [],
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
  /** Pyth exponent (int32). Almost always -8 for US equities. */
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
