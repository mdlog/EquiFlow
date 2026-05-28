import { NextResponse } from "next/server";
import {
  createPublicClient,
  encodePacked,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { readConfig, withWalletMutex, writeConfig } from "@/lib/web3/defender-store";
import { robinhoodChainTestnet } from "@/lib/config/chain";
import { EQUIFLOW_VAULT_ADDRESS } from "@/lib/contracts";
import { ApiError, withErrorHandler } from "@/lib/api/handler";
import {
  consumeReplayNonce,
  hashRegisterPayload,
  isHex,
  readBoundedJson,
  requireAddressValue,
  requireRateLimit,
  sanitizeError,
  verifySignature,
} from "@/lib/api/security";

// Limits — picked so a single attacker can't exhaust storage/CPU and so
// downstream BigInt math stays in safe bounds.
const MAX_EXPIRY_SECONDS = 90 * 86400;
const MIN_EXPIRY_FROM_NOW_S = 60 * 60; // 1h minimum to prevent trivially-expired authorizations
const MAX_WEEKLY_LIMIT_USDG = 1_000_000_000_000n; // 1M USDG (6-dec atomic)
const MIN_HEALTH_THRESHOLD = BigInt(1e18); // HF ≥ 1.0
const MAX_HEALTH_THRESHOLD = 5n * BigInt(1e18); // HF ≤ 5.0
const MAX_COLLATERAL_TOKENS = 32;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const INT_RE = /^\d{1,32}$/;

interface RegisterBody {
  wallet?: string;
  sessionKey?: string;
  weeklyLimitUsdg?: string; // 6-dec atomic, decimal string
  healthThreshold?: string; // 1e18-scaled, decimal string
  expiresAt?: number;
  collateralTokens?: string[];
  nonce?: string; // 0x + 32 bytes
  signature?: string; // 0x + 65 bytes EOA or arbitrary ERC-1271
  installUserOpHash?: string;
}

// Hash the canonicalised collateral list (sorted, lowercased) so two equivalent
// arrays produce the same EIP-712 digest. Empty list → ZERO_HASH.
function collateralTokensHash(addrs: Address[]): Hex {
  if (addrs.length === 0) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  const sorted = [...addrs].map((a) => a.toLowerCase() as Address).sort();
  const packed = encodePacked(
    sorted.map(() => "address" as const),
    sorted,
  );
  return keccak256(packed);
}

export const POST = withErrorHandler(async (req: Request) => {
  await requireRateLimit(req, { bucket: "defender-register", max: 10, windowSeconds: 60 });
  if (!EQUIFLOW_VAULT_ADDRESS) throw new ApiError(503, "vault_not_configured");

  const body = await readBoundedJson<RegisterBody>(req);

  // ── Shape validation ─────────────────────────────────────────────────
  const wallet = requireAddressValue(body.wallet, "wallet");
  const sessionKey = requireAddressValue(body.sessionKey, "session_key");

  if (!body.weeklyLimitUsdg || !INT_RE.test(body.weeklyLimitUsdg)) {
    throw new ApiError(400, "invalid_weekly_limit");
  }
  const weeklyLimit = BigInt(body.weeklyLimitUsdg);
  if (weeklyLimit === 0n || weeklyLimit > MAX_WEEKLY_LIMIT_USDG) {
    throw new ApiError(400, "weekly_limit_out_of_range");
  }

  if (!body.healthThreshold || !INT_RE.test(body.healthThreshold)) {
    throw new ApiError(400, "invalid_threshold");
  }
  const threshold = BigInt(body.healthThreshold);
  if (threshold < MIN_HEALTH_THRESHOLD || threshold > MAX_HEALTH_THRESHOLD) {
    throw new ApiError(400, "threshold_out_of_range");
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    typeof body.expiresAt !== "number" ||
    body.expiresAt <= now + MIN_EXPIRY_FROM_NOW_S ||
    body.expiresAt > now + MAX_EXPIRY_SECONDS
  ) {
    throw new ApiError(400, "invalid_expiry");
  }
  const expiresAt = body.expiresAt;

  // Collateral tokens: bounded, address-shaped, deduplicated.
  if (
    body.collateralTokens !== undefined &&
    (!Array.isArray(body.collateralTokens) ||
      body.collateralTokens.length > MAX_COLLATERAL_TOKENS)
  ) {
    throw new ApiError(400, "collateral_tokens_invalid");
  }
  const collateralTokens = (body.collateralTokens ?? []).filter(
    (t): t is string => typeof t === "string" && ADDR_RE.test(t),
  );
  const dedupedCollateral = Array.from(
    new Set(collateralTokens.map((t) => t.toLowerCase())),
  ) as Address[];

  // ── Anti-replay nonce ────────────────────────────────────────────────
  if (!body.nonce || !isHex(body.nonce, 66)) {
    throw new ApiError(400, "invalid_nonce");
  }
  await consumeReplayNonce(body.nonce, "defender-register");

  // ── Signature verification (EOA or ERC-1271) ─────────────────────────
  if (!body.signature || !isHex(body.signature, body.signature.length)) {
    throw new ApiError(400, "invalid_signature");
  }
  const tokensHash = collateralTokensHash(dedupedCollateral);
  const hash = hashRegisterPayload({
    chainId: robinhoodChainTestnet.id,
    verifyingContract: EQUIFLOW_VAULT_ADDRESS,
    wallet,
    sessionKey,
    weeklyLimitUsdg: weeklyLimit,
    healthThreshold: threshold,
    expiresAt: BigInt(expiresAt),
    collateralTokensHash: tokensHash,
    nonce: BigInt(body.nonce),
  });
  const publicClient = createPublicClient({
    chain: robinhoodChainTestnet,
    transport: http(),
  });
  let ok = false;
  try {
    ok = await verifySignature({
      publicClient,
      expectedSigner: wallet,
      hash,
      signature: body.signature as Hex,
    });
  } catch (err) {
    const { logMessage } = sanitizeError(err);
    console.warn("[defender/register] verifySignature error:", logMessage);
    throw new ApiError(401, "signature_check_failed");
  }
  if (!ok) throw new ApiError(401, "signature_invalid");

  // ── Persist (preserve weekUsed/weekStart across re-registers) ────────
  // The read-modify-write must be serialized per-wallet: two concurrent
  // registers with different nonces would both read the same `existing` and
  // race on the write — losing the policy from whichever lost the race.
  const installUserOpHash =
    typeof body.installUserOpHash === "string" && isHex(body.installUserOpHash, 66)
      ? body.installUserOpHash
      : undefined;

  await withWalletMutex(wallet, async () => {
    const existing = await readConfig(wallet);
    await writeConfig({
      wallet,
      sessionKey,
      threshold: threshold.toString(),
      weeklyLimit: weeklyLimit.toString(),
      weekUsed: existing?.weekUsed ?? "0",
      weekStart: existing?.weekStart ?? now,
      expiresAt,
      collateralTokens: dedupedCollateral,
      installUserOpHash,
      createdAt: existing?.createdAt ?? now,
    });
  });

  return NextResponse.json({ ok: true });
});
