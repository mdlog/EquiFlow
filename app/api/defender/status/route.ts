import { NextResponse } from "next/server";
import { createPublicClient, http, type Hex } from "viem";
import { readConfig } from "@/lib/web3/defender-store";
import { robinhoodChainTestnet } from "@/lib/config/chain";
import { EQUIFLOW_VAULT_ADDRESS } from "@/lib/contracts";
import { requireAddress, withErrorHandler } from "@/lib/api/handler";
import {
  hashStatusAuthPayload,
  isHex,
  requireRateLimit,
  sanitizeError,
  verifySignature,
} from "@/lib/api/security";

/// GET /api/defender/status?wallet=0x...
///   → public summary. Always safe to call.
/// GET /api/defender/status?wallet=0x...&sig=0x...&exp=<unix>
///   → full payload. `sig` is an EIP-712 signature over (wallet, exp) using
///     the same domain as defender register/revoke, proving the caller owns
///     the wallet. `exp` must be > now and within 7 days.
///
/// Without proof, the response excludes fields that disclose user behavior
/// (sessionKey, collateralTokens, installUserOpHash) — a passive observer
/// can confirm a wallet is registered + see its coarse policy, but cannot
/// enumerate the session-signer or collateral whitelist.

const MAX_AUTH_TTL_SECONDS = 7 * 86400;

export const GET = withErrorHandler(async (req: Request) => {
  await requireRateLimit(req, { bucket: "defender-status", max: 60, windowSeconds: 60 });
  const url = new URL(req.url);
  const wallet = requireAddress(url.searchParams.get("wallet"), "wallet");
  const cfg = await readConfig(wallet);
  const now = Math.floor(Date.now() / 1000);
  if (!cfg || cfg.expiresAt <= now) {
    return NextResponse.json({ enabled: false });
  }

  const summary = {
    enabled: true,
    wallet: cfg.wallet,
    threshold: cfg.threshold,
    weeklyLimit: cfg.weeklyLimit,
    weekUsed: cfg.weekUsed,
    weekStart: cfg.weekStart,
    expiresAt: cfg.expiresAt,
  };

  // Optional owner auth — when present, unlock the full payload.
  const sigRaw = url.searchParams.get("sig");
  const expRaw = url.searchParams.get("exp");
  if (!sigRaw || !expRaw || !EQUIFLOW_VAULT_ADDRESS) {
    return NextResponse.json(summary);
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now || exp > now + MAX_AUTH_TTL_SECONDS) {
    return NextResponse.json(summary);
  }
  if (!isHex(sigRaw, sigRaw.length)) {
    return NextResponse.json(summary);
  }

  const publicClient = createPublicClient({
    chain: robinhoodChainTestnet,
    transport: http(),
  });
  const hash = hashStatusAuthPayload({
    chainId: robinhoodChainTestnet.id,
    verifyingContract: EQUIFLOW_VAULT_ADDRESS,
    wallet,
    expiresAt: BigInt(exp),
  });
  let verified = false;
  try {
    verified = await verifySignature({
      publicClient,
      expectedSigner: wallet,
      hash,
      signature: sigRaw as Hex,
    });
  } catch (err) {
    const { logMessage } = sanitizeError(err);
    console.warn("[defender/status] auth verify failed:", logMessage);
  }
  if (!verified) {
    return NextResponse.json(summary);
  }

  return NextResponse.json({
    ...summary,
    sessionKey: cfg.sessionKey,
    collateralTokens: cfg.collateralTokens,
    installUserOpHash: cfg.installUserOpHash ?? null,
  });
});
