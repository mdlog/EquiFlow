// Pure, fully-testable core of the keeper: scale normalization, deviation,
// MockPyth payload encoding, and the push decision. No I/O, no viem clients.
// See docs/contracts/keeper-relay-spec.md.

import { encodeAbiParameters, type Hex } from "viem";

export interface HermesPrice {
  price: string; // decimal string (may be large -> BigInt)
  conf: string; // decimal string
  expo: number; // e.g. -5 for TSLA, -8 for others
  publish_time: number; // unix seconds
}

export interface HermesParsed {
  id: string; // hex, may lack 0x
  price: HermesPrice;
  ema_price: HermesPrice;
}

// Mirror of PythPriceAdapter._toE8: normalize a Pyth value to the fixed 1e8 scale.
export function toE8(price: bigint, expo: number): bigint {
  if (expo === -8) return price;
  if (expo < -8) return price / 10n ** BigInt(-expo - 8);
  return price * 10n ** BigInt(expo + 8);
}

// Absolute deviation of `newE8` from `cachedE8`, in basis points. A zero cache
// is treated as maximum deviation (forces a refresh).
export function deviationBps(newE8: bigint, cachedE8: bigint): bigint {
  if (cachedE8 <= 0n) return 10_000n;
  const diff = newE8 > cachedE8 ? newE8 - cachedE8 : cachedE8 - newE8;
  return (diff * 10_000n) / cachedE8;
}

const PRICE_COMPONENTS = [
  { name: "price", type: "int64" },
  { name: "conf", type: "uint64" },
  { name: "expo", type: "int32" },
  { name: "publishTime", type: "uint256" },
] as const;

// abi.encode(PythStructs.PriceFeed) — exactly what MockPyth.updatePriceFeeds decodes.
const FEED_PARAM = {
  type: "tuple",
  components: [
    { name: "id", type: "bytes32" },
    { name: "price", type: "tuple", components: PRICE_COMPONENTS },
    { name: "emaPrice", type: "tuple", components: PRICE_COMPONENTS },
  ],
} as const;

function priceTuple(p: HermesPrice) {
  // Raw values straight from Hermes — the adapter normalizes price (_toE8) and
  // confidence (_confToE8) on-chain. Do NOT pre-scale here.
  return {
    price: BigInt(p.price),
    conf: BigInt(p.conf),
    expo: p.expo,
    publishTime: BigInt(p.publish_time),
  };
}

export function encodePriceFeed(parsed: HermesParsed): Hex {
  const id = (parsed.id.startsWith("0x") ? parsed.id : `0x${parsed.id}`) as Hex;
  return encodeAbiParameters(
    [FEED_PARAM],
    [{ id, price: priceTuple(parsed.price), emaPrice: priceTuple(parsed.ema_price) }],
  );
}

export type Method = "update" | "force";
export type Decision =
  | { action: "skip"; reason: "not-newer" | "stale" | "no-trigger" }
  | { action: "push"; method: Method; deviationBps: bigint };

export interface DecideInput {
  hermesPublishTime: bigint; // seconds
  cachedUpdatedAt: bigint; // on-chain _updatedAt (= last publishTime), seconds
  nowSec: bigint;
  maxAgeSec: bigint; // 3600
  newE8: bigint; // toE8(hermes price)
  cachedE8: bigint; // latestRoundData().answer
  deviationCapBps: bigint; // 500 (5%) — on-chain updatePrice cap
  devTriggerBps: bigint; // 50 (0.5%) — push trigger threshold
  lastPushWallSec: bigint; // wall-clock of this feed's last successful push (0 if never)
  heartbeatSec: bigint; // 300
}

// Decide whether/how to push. Pre-computes update-vs-force from deviation so we
// avoid a guaranteed-revert updatePrice on a gap move; relay.ts still falls back
// to force if an "update" unexpectedly trips the on-chain cap.
export function decide(i: DecideInput): Decision {
  // (a) only strictly-newer data — MockPyth no-ops on equal/older, and the
  // adapter's L-2 guard rejects strictly-older. Never submit a non-advancing stamp.
  if (i.hermesPublishTime <= i.cachedUpdatedAt) return { action: "skip", reason: "not-newer" };
  // (b) freshness: skip if already older than maxAge vs now (market closed / very
  // stale) — avoids StalePrice / PublishTimeTooOld reverts. Asset goes stale by design.
  if (i.nowSec - i.hermesPublishTime > i.maxAgeSec) return { action: "skip", reason: "stale" };

  const dev = deviationBps(i.newE8, i.cachedE8);
  const heartbeatDue = i.lastPushWallSec === 0n || i.nowSec - i.lastPushWallSec >= i.heartbeatSec;
  if (!heartbeatDue && dev < i.devTriggerBps) return { action: "skip", reason: "no-trigger" };

  const method: Method = dev > i.deviationCapBps ? "force" : "update";
  return { action: "push", method, deviationBps: dev };
}
