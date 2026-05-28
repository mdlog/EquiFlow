import { NextResponse } from "next/server";
import { createPublicClient, http, type Hex } from "viem";
import { deleteConfig } from "@/lib/web3/defender-store";
import { robinhoodChainTestnet } from "@/lib/config/chain";
import { EQUIFLOW_VAULT_ADDRESS } from "@/lib/contracts";
import { ApiError, withErrorHandler } from "@/lib/api/handler";
import {
  consumeReplayNonce,
  hashRevokePayload,
  isHex,
  readBoundedJson,
  requireAddressValue,
  requireRateLimit,
  sanitizeError,
  verifySignature,
} from "@/lib/api/security";

interface RevokeBody {
  wallet?: string;
  expiresAt?: number;
  nonce?: string;
  signature?: string;
}

export const POST = withErrorHandler(async (req: Request) => {
  await requireRateLimit(req, { bucket: "defender-revoke", max: 20, windowSeconds: 60 });
  if (!EQUIFLOW_VAULT_ADDRESS) throw new ApiError(503, "vault_not_configured");

  const body = await readBoundedJson<RevokeBody>(req);
  const wallet = requireAddressValue(body.wallet, "wallet");

  const now = Math.floor(Date.now() / 1000);
  // expiresAt acts as a signature-validity window. Must be in the near future
  // (≤ 1h) so stolen revoke signatures expire quickly.
  if (
    typeof body.expiresAt !== "number" ||
    body.expiresAt <= now ||
    body.expiresAt > now + 3600
  ) {
    throw new ApiError(400, "invalid_expiry");
  }

  if (!body.nonce || !isHex(body.nonce, 66)) throw new ApiError(400, "invalid_nonce");
  await consumeReplayNonce(body.nonce, "defender-revoke");

  if (!body.signature || !isHex(body.signature, body.signature.length)) {
    throw new ApiError(400, "invalid_signature");
  }
  const hash = hashRevokePayload({
    chainId: robinhoodChainTestnet.id,
    verifyingContract: EQUIFLOW_VAULT_ADDRESS,
    wallet,
    expiresAt: BigInt(body.expiresAt),
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
    console.warn("[defender/revoke] verifySignature error:", logMessage);
    throw new ApiError(401, "signature_check_failed");
  }
  if (!ok) throw new ApiError(401, "signature_invalid");

  await deleteConfig(wallet);
  return NextResponse.json({ ok: true });
});
