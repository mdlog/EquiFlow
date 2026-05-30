// node --experimental-strip-types --test lib/web3/market-hours.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { inferMarketOpen, marketStatusCode, MARKET_OPEN_FRESH_SEC } from "./market-hours.ts";

const NOW = 1_780_000_000;

test("fresh data (30s old) => market OPEN", () => {
  assert.equal(inferMarketOpen(NOW - 30, NOW), true);
  assert.equal(marketStatusCode(NOW - 30, NOW), 0);
});

test("stale data (8.6h old, weekend) => market CLOSED", () => {
  assert.equal(inferMarketOpen(NOW - 31_000, NOW), false);
  assert.equal(marketStatusCode(NOW - 31_000, NOW), 1);
});

test("exactly at the threshold => still OPEN", () => {
  assert.equal(inferMarketOpen(NOW - MARKET_OPEN_FRESH_SEC, NOW), true);
});

test("one second past the threshold => CLOSED", () => {
  assert.equal(inferMarketOpen(NOW - MARKET_OPEN_FRESH_SEC - 1, NOW), false);
});
