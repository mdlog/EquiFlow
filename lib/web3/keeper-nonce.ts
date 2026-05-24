import type { Address, PublicClient } from "viem";

/// Process-wide nonce manager for the keeper signer.
///
/// Why this exists: both `/api/keeper/tick` (browser-driven, one adapter per
/// call) and `/api/keeper/cron` (sweep all adapters in one GET) write from the
/// same KEEPER_PRIVATE_KEY. Each used to call `eth_getTransactionCount(pending)`
/// independently inside viem's `writeContract`, so when their requests
/// interleaved on RBN testnet (whose RPC doesn't always reflect just-sent tx
/// in pending count) both picked the same nonce → "nonce too low" errors.
///
/// This module provides a single shared, in-memory mutex + monotonic counter.
/// Every keeper write must:
///   const nonce = await acquireNonce(publicClient, signerAddress);
///   await walletClient.writeContract({ ..., nonce });
///
/// On `submit_failed`, callers should call `resyncNonce()` so the next pull
/// re-reads chain state instead of trusting the stale counter.
///
/// Scope: single Next.js process (works for `next dev`, single-instance Node
/// deploys). Multi-region/serverless deploys with no sticky routing would need
/// Redis/Upstash-backed coordination instead — out of scope for the local-dev
/// + small-deploy demo.

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

export async function acquireNonce(
  client: PublicClient,
  address: Address,
): Promise<number> {
  const job = chain.then(async () => {
    // Re-sync from chain on first use or signer change.
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
/// if a tx was rejected before reaching the mempool.
export function resyncNonce(): void {
  state.next = -1;
}
