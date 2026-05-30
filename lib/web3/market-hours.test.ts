// node --experimental-strip-types --test lib/web3/market-hours.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inferMarketOpen,
  marketStatusCode,
  MARKET_OPEN_FRESH_SEC,
  isMarketTradingClosed,
  marketStatusLabel,
  isBorrowBlockedByMarket,
} from "./market-hours.ts";

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

// --- On-chain marketStatus interpretation (UI gating) ---------------------
// The vault stores 0=OPEN, 1=CLOSED, 2=HALTED. `undefined` is the still-loading
// state on the client — must read as "open" so the UI never blocks prematurely
// before the read resolves.

test("isMarketTradingClosed: undefined/null (loading) => not closed", () => {
  assert.equal(isMarketTradingClosed(undefined), false);
  assert.equal(isMarketTradingClosed(null), false);
});

test("isMarketTradingClosed: 0 => open, 1 (CLOSED) and 2 (HALTED) => closed", () => {
  assert.equal(isMarketTradingClosed(0), false);
  assert.equal(isMarketTradingClosed(1), true);
  assert.equal(isMarketTradingClosed(2), true);
});

test("marketStatusLabel maps each status code", () => {
  assert.equal(marketStatusLabel(undefined), "Market open");
  assert.equal(marketStatusLabel(0), "Market open");
  assert.equal(marketStatusLabel(1), "Market closed");
  assert.equal(marketStatusLabel(2), "Trading halted");
});

test("isBorrowBlockedByMarket: only blocks when closed AND borrowing", () => {
  // closed + borrowing => blocked
  assert.equal(isBorrowBlockedByMarket(1, 100), true);
  assert.equal(isBorrowBlockedByMarket(2, 50), true);
  // closed but deposit-only (borrowUsd 0) => allowed (pledge isn't gated)
  assert.equal(isBorrowBlockedByMarket(1, 0), false);
  // open + borrowing => allowed
  assert.equal(isBorrowBlockedByMarket(0, 100), false);
  // loading + borrowing => allowed (on-chain stays source of truth)
  assert.equal(isBorrowBlockedByMarket(undefined, 100), false);
});
