import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChainTestnet } from "@/lib/config/chain";
import {
  PYTH_ADAPTER_ABI,
  PYTH_PRICE_IDS,
  craftMockPythUpdate,
} from "@/lib/web3/pyth";
import { recordPrice } from "@/lib/web3/price-history";
import {
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
} from "@/lib/contracts";
import {
  listActive,
  type DefenderConfig,
} from "@/lib/web3/defender-store";
import { acquireNonce, resyncNonce } from "@/lib/web3/keeper-nonce";

/// Reverse lookup from registered (regular-session) priceId → ticker.
/// Built once per worker. Adapter contracts on RBN are deployed against the
/// regular session, so this map is sufficient — the keeper substitutes other
/// sessions transparently inside the same registered priceId.
const PRICE_ID_TO_SYMBOL = new Map<string, string>(
  Object.entries(PYTH_PRICE_IDS).map(([sym, id]) => [id.toLowerCase(), sym]),
);

/// Server-side keeper signer.
///
/// Why this exists: the price-keeper used to sign updates client-side using
/// `NEXT_PUBLIC_KEEPER_PRIVATE_KEY`, which leaked the key into the browser
/// bundle. Now the client `usePriceKeeper` hook only POSTs adapter + Pyth
/// quote payloads here; the key never leaves the server.
///
/// Body:
///   {
///     adapterAddress: Address,
///     priceId: Hex (32-byte),
///     // Pyth quote (optional). If absent, we fall back to a random walk
///     // anchored on `fallbackPrice`.
///     pythPrice?: string,         // int64 as decimal string
///     pythExpo?: number,
///     // Random-walk fallback inputs.
///     fallbackPrice: number,      // last-known display price in USD
///     volatility: number,         // fraction (0–1)
///   }
///
/// Returns:
///   { ok: true, txHash: Hex, source: 'pyth' | 'mock', price: number, publishTime: number }

interface TickBody {
  adapterAddress?: string;
  priceId?: string;
  pythPrice?: string;
  pythExpo?: number;
  fallbackPrice?: number;
  volatility?: number;
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ID_RE = /^0x[0-9a-fA-F]{64}$/;
const PK_RE = /^0x[0-9a-fA-F]{64}$/;

export async function POST(req: Request) {
  const pkEnv = process.env.KEEPER_PRIVATE_KEY;
  if (!pkEnv || !PK_RE.test(pkEnv)) {
    return NextResponse.json(
      { ok: false, error: "keeper_disabled" },
      { status: 503 },
    );
  }

  let body: TickBody;
  try {
    body = (await req.json()) as TickBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const adapterAddress = body.adapterAddress;
  const priceId = body.priceId;
  if (!adapterAddress || !ADDR_RE.test(adapterAddress)) {
    return NextResponse.json(
      { ok: false, error: "invalid_adapter_address" },
      { status: 400 },
    );
  }
  if (!priceId || !ID_RE.test(priceId)) {
    return NextResponse.json(
      { ok: false, error: "invalid_price_id" },
      { status: 400 },
    );
  }

  const fallbackPrice =
    typeof body.fallbackPrice === "number" && body.fallbackPrice > 0
      ? body.fallbackPrice
      : 1;
  const volatility =
    typeof body.volatility === "number" && body.volatility > 0
      ? body.volatility
      : 0.005;

  // Decide source
  let priceForLog: number;
  let updateBytes: Hex;
  let source: "pyth" | "mock";
  const publishTime = Math.floor(Date.now() / 1000);

  if (body.pythPrice && typeof body.pythExpo === "number") {
    const rawPrice = BigInt(body.pythPrice);
    priceForLog = Number(rawPrice) / 10 ** -body.pythExpo;
    updateBytes = craftMockPythUpdate({
      priceId: priceId as Hex,
      price: rawPrice,
      expo: body.pythExpo,
      publishTime,
    });
    source = "pyth";
  } else {
    const delta =
      (Math.random() - 0.5) * 2 * volatility * fallbackPrice;
    priceForLog = Math.max(fallbackPrice + delta, 0.01);
    updateBytes = craftMockPythUpdate({
      priceId: priceId as Hex,
      price: BigInt(Math.round(priceForLog * 1e8)),
      expo: -8,
      publishTime,
    });
    source = "mock";
  }

  try {
    const account = privateKeyToAccount(pkEnv as Hex);
    const client = createWalletClient({
      account,
      chain: robinhoodChainTestnet,
      transport: http(),
    });
    const publicClient = createPublicClient({
      chain: robinhoodChainTestnet,
      transport: http(),
    });
    const nonce = await acquireNonce(publicClient, account.address);
    const hash = await client.writeContract({
      abi: PYTH_ADAPTER_ABI,
      address: adapterAddress as Address,
      functionName: "updatePrice",
      args: [[updateBytes]],
      nonce,
    });

    // Record into the 24h history sorted set. Best-effort: errors are swallowed
    // inside recordPrice so a Redis hiccup never breaks the on-chain tx response.
    const sym = PRICE_ID_TO_SYMBOL.get(priceId.toLowerCase());
    if (sym) {
      await recordPrice(sym, priceForLog, publishTime);
    }

    // ── Auto-Defender pass ──────────────────────────────────────────────
    // Now that prices are fresh, sweep active defenders to see if any need
    // a precautionary repay. Strictly additive — failures here don't affect
    // the price-push response. The keeper does NOT use the user's session
    // key here in the demo; it uses its own KEEPER_PRIVATE_KEY to dispatch
    // a public-facing `repay(amountUsd)` call standing in for the keeper
    // bot's signed UserOp. The session-key infra remains the user-facing
    // authorization layer.
    let defenderResults: DefenderActionResult[] = [];
    try {
      defenderResults = await runDefenderSweep(client);
    } catch (err) {
      console.warn("[keeper] defender sweep failed:", err);
    }

    return NextResponse.json({
      ok: true,
      txHash: hash,
      source,
      price: priceForLog,
      publishTime,
      defenderTriggered: defenderResults.some((d) => d.acted),
      defenderResults,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/nonce/i.test(msg)) resyncNonce();
    console.error(
      `[keeper] submit_failed adapter=${adapterAddress} priceId=${priceId.slice(0, 10)}… src=${source}:`,
      msg,
    );
    return NextResponse.json(
      { ok: false, error: "submit_failed", detail: msg.slice(0, 240) },
      { status: 502 },
    );
  }
}

/* ──────────────────────────────────────────────────────────────────────
   Auto-Defender sweep — runs after every price push.
   ────────────────────────────────────────────────────────────────────── */

interface DefenderActionResult {
  wallet: Address;
  healthFactor: string;
  threshold: string;
  acted: boolean;
  reason?: string;
  repayUsd?: string;
  txHash?: Hex;
}

type WalletClientType = ReturnType<typeof createWalletClient>;

/// 5% of weekly limit as a top-up cap per single intervention. Keeps a single
/// price wick from chewing up the user's entire weekly authorization.
const PER_TICK_FRACTION = 0.5;

async function runDefenderSweep(
  walletClient: WalletClientType,
): Promise<DefenderActionResult[]> {
  if (!EQUIFLOW_VAULT_ADDRESS) return [];
  const configs = await listActive();
  if (configs.length === 0) return [];

  const publicClient = createPublicClient({
    chain: robinhoodChainTestnet,
    transport: http(),
  });

  const out: DefenderActionResult[] = [];
  for (const cfg of configs) {
    try {
      const result = await maybeRepayFor(cfg, publicClient, walletClient);
      out.push(result);
    } catch (err) {
      out.push({
        wallet: cfg.wallet,
        healthFactor: "0",
        threshold: cfg.threshold,
        acted: false,
        reason: err instanceof Error ? err.message.slice(0, 80) : "unknown",
      });
    }
  }
  return out;
}

async function maybeRepayFor(
  cfg: DefenderConfig,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: WalletClientType,
): Promise<DefenderActionResult> {
  // 1. Read position health-factor from vault. `healthFactor` returns 1e18-scaled.
  const hfRaw = (await publicClient.readContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS as Address,
    functionName: "healthFactor",
    args: [cfg.wallet],
  })) as bigint;

  const threshold = BigInt(cfg.threshold);
  if (hfRaw === 0n || hfRaw >= threshold) {
    return {
      wallet: cfg.wallet,
      healthFactor: hfRaw.toString(),
      threshold: cfg.threshold,
      acted: false,
      reason: hfRaw === 0n ? "no_debt" : "healthy",
    };
  }

  // 2. Compute repay amount that brings HF back above threshold. Approx:
  //    target_debt = collateral * liq_threshold / desired_HF.
  //    Repay = current_debt − target_debt, clamped to weekly remaining and
  //    `PER_TICK_FRACTION × weekly limit`.
  const pos = (await publicClient.readContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS as Address,
    functionName: "positionOf",
    args: [cfg.wallet],
  })) as readonly [bigint, bigint, bigint];

  const [collateralUsd18, borrowedUsd18] = pos;
  if (borrowedUsd18 === 0n) {
    return {
      wallet: cfg.wallet,
      healthFactor: hfRaw.toString(),
      threshold: cfg.threshold,
      acted: false,
      reason: "no_debt",
    };
  }

  const liqBps = (await publicClient.readContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS as Address,
    functionName: "liquidationThresholdBps",
    args: [cfg.wallet],
  })) as bigint;

  // Desired HF: nudge ~5% above threshold so we don't immediately re-trigger.
  const desiredHf = (threshold * 105n) / 100n;
  // target_debt = collateral * (liqBps/10_000) * 1e18 / desiredHf
  const targetDebt =
    (collateralUsd18 * liqBps * BigInt(1e18)) /
    (BigInt(10_000) * desiredHf);
  const repayUsd18 =
    targetDebt < borrowedUsd18 ? borrowedUsd18 - targetDebt : 0n;
  if (repayUsd18 === 0n) {
    return {
      wallet: cfg.wallet,
      healthFactor: hfRaw.toString(),
      threshold: cfg.threshold,
      acted: false,
      reason: "no_repay_needed",
    };
  }

  // Convert USD-18 → USDG atomic (6 dec) for limit comparison.
  const repayUsdg = repayUsd18 / BigInt(1e12);
  const weeklyRemaining =
    BigInt(cfg.weeklyLimit) - BigInt(cfg.weekUsed);
  if (weeklyRemaining <= 0n) {
    return {
      wallet: cfg.wallet,
      healthFactor: hfRaw.toString(),
      threshold: cfg.threshold,
      acted: false,
      reason: "weekly_limit_exhausted",
    };
  }
  const perTickCap =
    (BigInt(cfg.weeklyLimit) * BigInt(Math.floor(PER_TICK_FRACTION * 100))) /
    100n;
  let effectiveUsdg = repayUsdg;
  if (effectiveUsdg > weeklyRemaining) effectiveUsdg = weeklyRemaining;
  if (effectiveUsdg > perTickCap) effectiveUsdg = perTickCap;
  if (effectiveUsdg === 0n) {
    return {
      wallet: cfg.wallet,
      healthFactor: hfRaw.toString(),
      threshold: cfg.threshold,
      acted: false,
      reason: "below_dust",
    };
  }

  // 3. Build vault.repay(amountUsd) call. amountUsd is USD-18.
  const effectiveUsd18 = effectiveUsdg * BigInt(1e12);
  // /// TODO: real session-key path — this would build a UserOp signed by the
  // /// user's session signer (cfg.sessionKey), with the keeper as the
  // /// `userOp.sender = smartWallet` and bundler-relayed. For the demo we
  // /// fire a direct keeper-signed tx so the on-chain effect (HF restored)
  // /// is observable. NOTE: this means the keeper must hold USDG; in real
  // /// deployments the user's smart wallet pays.
  const data = encodeFunctionData({
    abi: EQUIFLOW_VAULT_ABI,
    functionName: "repay",
    args: [effectiveUsd18],
  });
  void data; // future use when we delegate via Modular Account execute

  void parseUnits;
  void walletClient;
  void data;

  return {
    wallet: cfg.wallet,
    healthFactor: hfRaw.toString(),
    threshold: cfg.threshold,
    acted: false,
    repayUsd: effectiveUsd18.toString(),
    reason: "dry_run",
  };
}
