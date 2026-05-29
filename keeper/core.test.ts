// node --import tsx --test keeper/core.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, type Hex } from "viem";
import { toE8, deviationBps, encodePriceFeed, decide, type HermesParsed } from "./core.ts";

// Independent (hand-written) decode shape — if core.ts's FEED_PARAM types/order
// are wrong, the round-trip below mismatches and the test fails.
const PRICE = [
  { name: "price", type: "int64" },
  { name: "conf", type: "uint64" },
  { name: "expo", type: "int32" },
  { name: "publishTime", type: "uint256" },
] as const;
const FEED = [{
  type: "tuple",
  components: [
    { name: "id", type: "bytes32" },
    { name: "price", type: "tuple", components: PRICE },
    { name: "emaPrice", type: "tuple", components: PRICE },
  ],
}] as const;

test("toE8: expo === -8 is identity", () => {
  assert.equal(toE8(348_51000000n, -8), 348_51000000n);
});

test("toE8: live TSLA expo === -5 normalizes to 1e8 ($433.81)", () => {
  // 43380934 * 10^(-5) = $433.80934  ->  43380934 * 1000 = 43380934000 (1e8)
  assert.equal(toE8(43380934n, -5), 43380934000n);
});

test("toE8: expo < -8 divides down", () => {
  // 3485100000000 * 10^(-10) = $348.51 -> /100 = 34851000000 (1e8)
  assert.equal(toE8(3485100000000n, -10), 34851000000n);
});

test("deviationBps: 5% move = 500 bps", () => {
  assert.equal(deviationBps(10_500n, 10_000n), 500n);
  assert.equal(deviationBps(9_500n, 10_000n), 500n);
});

test("deviationBps: zero cache => max (10000)", () => {
  assert.equal(deviationBps(123n, 0n), 10_000n);
});

test("encodePriceFeed: round-trips raw Hermes values and 0x-prefixes the id", () => {
  const parsed: HermesParsed = {
    id: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", // no 0x (as Hermes returns)
    price: { price: "43380934", conf: "30066", expo: -5, publish_time: 1780063858 },
    ema_price: { price: "43748264", conf: "32142", expo: -5, publish_time: 1780063858 },
  };
  const data = encodePriceFeed(parsed) as Hex;
  const [feed] = decodeAbiParameters(FEED, data) as any;
  assert.equal(feed.id.toLowerCase(), `0x${parsed.id}`);
  assert.equal(feed.price.price, 43380934n);
  assert.equal(feed.price.conf, 30066n);
  assert.equal(feed.price.expo, -5);
  assert.equal(feed.price.publishTime, 1780063858n);
  assert.equal(feed.emaPrice.price, 43748264n);
});

const base = {
  hermesPublishTime: 1000n,
  cachedUpdatedAt: 900n,
  nowSec: 1010n,
  maxAgeSec: 3600n,
  newE8: 10_000n,
  cachedE8: 10_000n,
  deviationCapBps: 500n,
  devTriggerBps: 50n,
  lastPushWallSec: 1005n, // recent push (heartbeat not due)
  heartbeatSec: 300n,
};

test("decide: skips non-newer publishTime", () => {
  assert.deepEqual(decide({ ...base, hermesPublishTime: 900n }), { action: "skip", reason: "not-newer" });
});

test("decide: skips stale (older than maxAge vs now)", () => {
  assert.deepEqual(decide({ ...base, hermesPublishTime: 901n, cachedUpdatedAt: 900n, nowSec: 5000n }), { action: "skip", reason: "stale" });
});

test("decide: skips when no heartbeat-due and below deviation trigger", () => {
  assert.deepEqual(decide({ ...base, newE8: 10_010n }), { action: "skip", reason: "no-trigger" }); // 10 bps < 50
});

test("decide: update when deviation within cap", () => {
  const d = decide({ ...base, newE8: 10_300n }); // 300 bps: > trigger, <= cap
  assert.equal(d.action, "push");
  if (d.action === "push") assert.equal(d.method, "update");
});

test("decide: force when deviation exceeds cap", () => {
  const d = decide({ ...base, newE8: 12_000n }); // 2000 bps > 500 cap
  assert.equal(d.action, "push");
  if (d.action === "push") assert.equal(d.method, "force");
});

test("decide: heartbeat-due pushes even with zero deviation", () => {
  const d = decide({ ...base, lastPushWallSec: 0n }); // never pushed => heartbeat due
  assert.equal(d.action, "push");
  if (d.action === "push") assert.equal(d.method, "update");
});
