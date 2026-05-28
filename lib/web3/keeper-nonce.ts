import type { Address, PublicClient } from "viem";
import {
  UPSTASH_REST_CONFIGURED,
  upstashDel,
  upstashIncrement,
  upstashSetNx,
} from "@/lib/api/security";

/// Process-wide nonce manager for the keeper signer.
///
/// Why this exists: both `/api/keeper/tick` (browser-driven, one adapter per
/// call) and `/api/keeper/cron` (sweep all adapters in one GET) write from the
/// same KEEPER_PRIVATE_KEY. Each used to call `eth_getTransactionCount(pending)`
/// independently inside viem's `writeContract`, so when their requests
/// interleaved on RBN testnet (whose RPC doesn't always reflect just-sent tx
/// in pending count) both picked the same nonce → "nonce too low" errors.
///
/// Two coordination layers:
///   1. **Upstash counter (preferred)** — atomic INCR across Vercel lambdas.
///      Seeded once via SET NX with the on-chain pending count, then every
///      `acquireNonce` does an atomic INCR. On `resyncNonce`, the counter is
///      DEL'd so the next call re-seeds from chain.
///   2. **In-process promise chain (fallback)** — single-instance dev mode,
///      or when Upstash isn't configured. Same monotonic counter, serialized
///      via promise chain. Lost on restart, per-process only.
///
/// Every keeper write must:
///   const nonce = await acquireNonce(publicClient, signerAddress);
///   await walletClient.writeContract({ ..., nonce });
///
/// On `submit_failed`, callers should call `resyncNonce()` so the next pull
/// re-reads chain state instead of trusting the stale counter.

type NonceState = {
  /** Last nonce HANDED OUT. Next caller gets `next + 1`. -1 = uninitialized. */
  next: number;
  /** Address this counter belongs to. Re-init if the signer changes. */
  forAddress: Address | null;
};

const state: NonceState = { next: -1, forAddress: null };

/// Single-slot promise chain. Each `acquireNonce` chains onto `chain`, so
/// concurrent callers serialize without race. Lightweight — no external deps.
let chain: Promise<unknown> = Promise.resolve();

const NONCE_TTL_S = 24 * 60 * 60; // 1 day — survives weekday lulls
const counterKey = (addr: Address) => `keeper:nonce:${addr.toLowerCase()}`;

async function seedAndIncrUpstash(
  client: PublicClient,
  address: Address,
): Promise<number | null> {
  if (!UPSTASH_REST_CONFIGURED) return null;
  // Try to seed the counter if absent. The seed value is one BELOW the
  // expected next nonce, so the immediate INCR yields the next valid nonce.
  const onchainPending = await client.getTransactionCount({
    address,
    blockTag: "pending",
  });
  const seedValue = onchainPending - 1;
  const created = await upstashSetNx(counterKey(address), String(seedValue), NONCE_TTL_S);
  if (created === null) {
    // Upstash transport failure — return null so caller can fall back to
    // the in-process chain (dev) or surface the failure (prod).
    return null;
  }
  const newVal = await upstashIncrement(counterKey(address));
  if (newVal === null) return null;
  // Defensive: if the existing counter was somehow ahead of chain, our INCR
  // result is still monotonic — viem will surface "nonce too low" if it
  // collides with an already-mined tx, and resyncNonce() handles recovery.
  return newVal;
}

export async function acquireNonce(
  client: PublicClient,
  address: Address,
): Promise<number> {
  // Always serialize through the in-process chain even when Upstash is the
  // source of truth — keeps the SETNX + INCR pair from being interleaved by
  // two concurrent acquires inside the same lambda.
  const job = chain.then(async () => {
    const upstashNonce = await seedAndIncrUpstash(client, address);
    if (upstashNonce !== null) {
      state.next = upstashNonce;
      state.forAddress = address;
      return upstashNonce;
    }

    // Fallback path. Re-sync from chain on first use or signer change.
    if (state.forAddress?.toLowerCase() !== address.toLowerCase() || state.next < 0) {
      const onchain = await client.getTransactionCount({
        address,
        blockTag: "pending",
      });
      state.next = onchain - 1; // so `++next` returns `onchain`
      state.forAddress = address;
    }
    state.next += 1;
    return state.next;
  });
  // Swallow errors on the chain so one failure doesn't poison subsequent waits.
  chain = job.catch(() => undefined);
  return job;
}

/// Force re-read from chain on next acquire. Call this after a write fails
/// with a nonce-related error — the in-memory counter may be ahead of reality
/// if a tx was rejected before reaching the mempool. Also clears the Upstash
/// counter so peer lambdas re-seed too.
export function resyncNonce(): void {
  state.next = -1;
  if (state.forAddress) {
    void upstashDel(counterKey(state.forAddress));
  }
}
