import { NextResponse } from "next/server";
import { deleteConfig } from "@/lib/web3/defender-store";
import {
  readJsonBody,
  requireAddress,
  withErrorHandler,
} from "@/lib/api/handler";

interface RevokeBody {
  wallet?: string;
  /// Optional EOA/smart-account signature over { wallet, action:"revoke" }.
  /// Not strictly validated in demo — the user revoking off-chain only
  /// affects the keeper's backend record, not on-chain authorization.
  signature?: string;
}

export const POST = withErrorHandler(async (req: Request) => {
  const body = await readJsonBody<RevokeBody>(req);
  const wallet = requireAddress(body.wallet, "wallet");
  await deleteConfig(wallet);
  return NextResponse.json({ ok: true });
});
