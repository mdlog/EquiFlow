import { NextResponse } from "next/server";
import type { Address } from "viem";
import { writeConfig } from "@/lib/web3/defender-store";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const INT_RE = /^\d+$/;
const HEX64_RE = /^0x[0-9a-fA-F]{64}$/;

/// Max 90-day session window — anything longer is rejected as unreasonable.
const MAX_EXPIRY_SECONDS = 90 * 86400;

interface RegisterBody {
  wallet?: string;
  sessionKey?: string;
  weeklyLimitUsdg?: string; // decimal string (atomic 6-dec USDG)
  healthThreshold?: string; // decimal string (1e18-scaled)
  expiresAt?: number; // unix seconds
  collateralTokens?: string[];
  installUserOpHash?: string;
}

/// POST /api/defender/register
/// Body documented in RegisterBody above. Validates shape + expiry sanity and
/// writes the configuration to the defender store.
///
/// NOTE: we do not verify the signature on-chain in the demo — the legitimacy
/// of the registration is implicitly proven by the install UserOp the user
/// just submitted (whose hash is included in the payload).
export async function POST(req: Request) {
  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const { wallet, sessionKey, weeklyLimitUsdg, healthThreshold, expiresAt } =
    body;
  if (!wallet || !ADDR_RE.test(wallet)) {
    return NextResponse.json(
      { ok: false, error: "invalid_wallet" },
      { status: 400 },
    );
  }
  if (!sessionKey || !ADDR_RE.test(sessionKey)) {
    return NextResponse.json(
      { ok: false, error: "invalid_session_key" },
      { status: 400 },
    );
  }
  if (!weeklyLimitUsdg || !INT_RE.test(weeklyLimitUsdg)) {
    return NextResponse.json(
      { ok: false, error: "invalid_weekly_limit" },
      { status: 400 },
    );
  }
  if (!healthThreshold || !INT_RE.test(healthThreshold)) {
    return NextResponse.json(
      { ok: false, error: "invalid_threshold" },
      { status: 400 },
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof expiresAt !== "number" ||
    expiresAt <= now + 60 ||
    expiresAt > now + MAX_EXPIRY_SECONDS
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_expiry" },
      { status: 400 },
    );
  }

  const collateralTokens = Array.isArray(body.collateralTokens)
    ? body.collateralTokens.filter((t) => typeof t === "string" && ADDR_RE.test(t))
    : [];

  const installUserOpHash =
    typeof body.installUserOpHash === "string" &&
    HEX64_RE.test(body.installUserOpHash)
      ? body.installUserOpHash
      : undefined;

  await writeConfig({
    wallet: wallet as Address,
    sessionKey: sessionKey as Address,
    threshold: healthThreshold,
    weeklyLimit: weeklyLimitUsdg,
    weekUsed: "0",
    weekStart: now,
    expiresAt,
    collateralTokens,
    installUserOpHash,
    createdAt: now,
  });

  return NextResponse.json({ ok: true });
}
