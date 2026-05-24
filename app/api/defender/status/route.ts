import { NextResponse } from "next/server";
import { readConfig } from "@/lib/web3/defender-store";
import { requireAddress, withErrorHandler } from "@/lib/api/handler";

/// GET /api/defender/status?wallet=0x...
/// Returns the active defender config for a smart wallet, or { enabled: false }.
export const GET = withErrorHandler(async (req: Request) => {
  const wallet = requireAddress(
    new URL(req.url).searchParams.get("wallet"),
    "wallet",
  );
  const cfg = await readConfig(wallet);
  const now = Math.floor(Date.now() / 1000);
  if (!cfg || cfg.expiresAt <= now) {
    return NextResponse.json({ enabled: false });
  }
  return NextResponse.json({
    enabled: true,
    wallet: cfg.wallet,
    sessionKey: cfg.sessionKey,
    threshold: cfg.threshold,
    weeklyLimit: cfg.weeklyLimit,
    weekUsed: cfg.weekUsed,
    weekStart: cfg.weekStart,
    expiresAt: cfg.expiresAt,
    collateralTokens: cfg.collateralTokens,
    installUserOpHash: cfg.installUserOpHash ?? null,
  });
});
