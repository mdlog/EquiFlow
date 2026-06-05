// node --experimental-strip-types --test lib/web3/network.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isWrongNetwork } from "./network.ts";

const RBN = 46630;

test("not connected => never prompt (false)", () => {
  assert.equal(isWrongNetwork(false, undefined, RBN), false);
  assert.equal(isWrongNetwork(false, 1, RBN), false);
});

test("connected but chain still resolving (undefined) => false", () => {
  assert.equal(isWrongNetwork(true, undefined, RBN), false);
});

test("connected on the target chain => false", () => {
  assert.equal(isWrongNetwork(true, RBN, RBN), false);
});

test("connected on a different chain => true (prompt the switch)", () => {
  assert.equal(isWrongNetwork(true, 1, RBN), true); // Ethereum mainnet
  assert.equal(isWrongNetwork(true, 42161, RBN), true); // Arbitrum
});
