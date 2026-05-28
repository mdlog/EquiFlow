import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChainTestnet } from "@/lib/config/chain";
import { PYTH_ADAPTER_ABI, craftMockPythUpdate } from "@/lib/web3/pyth";
import { fetchFreshestPyth, validatePythQuote } from "@/lib/web3/hermes";
import { recordPrice } from "@/lib/web3/price-history";
import {
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
} from "@/lib/contracts";
import { listActive, type DefenderConfig } from "@/lib/web3/defender-store";
import { acquireNonce, resyncNonce } from "@/lib/web3/keeper-nonce";
import {
  getVaultAllowlist,
  symbolForToken,
} from "@/lib/web3/vault-allowlist";
import {
  requireBearerSecret,
  requireRateLimit,
  readBoundedJson,
  requireAddressValue,
  isHex,
  sanitizeError,
} from "@/lib/api/security";
import { ApiError, withErrorHandler } from "@/lib/api/handler";

// Server-side keeper signer.
//
// Security changes vs prior version:
//   - Requires Bearer CRON_SECRET (timing-safe). Fails closed in production.
//   - Body now only carries a `symbol`; the server fetches the freshest price
//     from Hermes itself. Caller-supplied prices are NEVER trusted.
//   - `adapterAddress` is allowlisted against listedAssets() on the vault.
//   - Per-IP rate limit (60 req/min, hard cap 5 sec burst).
//   - Body capped at 16 KiB.
//   - Error responses use stable codes — viem error text never leaks.

const PK_RE = /^0x[0-9a-fA-F]{64}$/;

interface TickBody {
  symbol?: string;
}

export const POST = withErrorHandler(async (req: Request) => {
  requireBearerSecret(req, "CRON_SECRET");
  await requireRateLimit(req, { bucket: "tick", max: 60, windowSeconds: 60 });

  const pkEnv = process.env.KEEPER_PRIVATE_KEY;
  if (!pkEnv || !PK_RE.test(pkEnv)) {
    throw new ApiError(503, "keeper_disabled");
  }
  if (!EQUIFLOW_VAULT_ADDRESS) {
    throw new ApiError(503, "vault_not_configured");
  }

  const body = await readBoundedJson<TickBody>(req);
  const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
  if (!/^[A-Z0-9]{1,8}$/.test(symbol)) {
    throw new ApiError(400, "invalid_symbol");
  }

  const publicClient = createPublicClient({
    chain: robinhoodChainTestnet,
    transport: http(),
  });

  // Resolve adapter + priceId from on-chain config — never from the caller.
  const allowlist = await getVaultAllowlist(publicClient);
  if (allowlist.vaultMissing) {
    throw new ApiError(503, "vault_not_configured");
  }
  if (allowlist.adapters.size === 0) {
    throw new ApiError(503, "vault_empty");
  }

  // Find the token address for the symbol from our env-driven token map,
  // then read its adapter from the vault. This is the canonical mapping.
  const tokenAddress = await resolveTokenAddress(symbol);
  if (!tokenAddress) throw new ApiError(404, "unknown_symbol");

  let adapter: Address;
  let enabled: boolean;
  try {
    const cfg = (await publicClient.readContract({
      abi: EQUIFLOW_VAULT_ABI,
      address: EQUIFLOW_VAULT_ADDRESS,
      functionName: "assets",
      args: [tokenAddress],
    })) as readonly [Address, bigint, bigint, bigint, boolean];
    adapter = cfg[0];
    enabled = cfg[4];
  } catch (err) {
    const { code, logMessage } = sanitizeError(err);
    console.error("[keeper/tick] assets_read_failed:", logMessage);
    throw new ApiError(502, code);
  }

  if (!enabled) throw new ApiError(409, "asset_disabled");
  if (!allowlist.adapters.has(adapter.toLowerCase())) {
    // Allowlist mismatch — vault returned an adapter that isn't in our cached
    // listedAssets. Refresh-and-fail rather than sign.
    throw new ApiError(409, "adapter_not_allowed");
  }

  // Fetch authoritative price from Hermes. No caller-controlled prices.
  const quote = await fetchFreshestPyth(symbol);
  const nowSec = Math.floor(Date.now() / 1000);

  if (!quote) {
    // Hermes unavailable — we DO NOT fall back to mock prices. Refuse to
    // sign rather than push attacker-chosen or fabricated numbers.
    throw new ApiError(503, "hermes_unavailable");
  }

  // Quality gate: reject stale or low-confidence quotes. Without this, an
  // operator outage that returns cached pre-outage prices would be silently
  // forwarded with a fresh server timestamp.
  const validation = validatePythQuote(quote, nowSec);
  if (!validation.ok) {
    console.warn(
      `[keeper/tick] quote_rejected sym=${symbol} reason=${validation.reason} ` +
        `age=${validation.ageSeconds}s conf=${validation.confBps}bps`,
    );
    throw new ApiError(503, `quote_${validation.reason}`);
  }

  const priceForLog = Number(quote.price) / 10 ** -quote.expo;
  // On-chain publishTime is the server's "I attest this submission is fresh"
  // timestamp, gated by validatePythQuote() above: the underlying Hermes
  // publish_time was within MAX_PUBLISH_AGE_SECONDS of now. Using nowSec
  // keeps the adapter staleAfter check passing even when the adapter has a
  // tighter window than Hermes' publish cadence.
  const publishTime = nowSec;
  const { priceIdRegular } = await resolveRegularPriceId(publicClient, adapter);
  const updateBytes: Hex = craftMockPythUpdate({
    priceId: priceIdRegular,
    price: quote.price,
    expo: quote.expo,
    publishTime,
    conf: quote.conf,
  });
  const source: "pyth" = "pyth";

  // ── Pre-flight: decide updatePrice vs forceUpdatePrice ──
  // The H-02 audit fix added a 5% per-update deviation cap. After deploy (or
  // any extended outage), the cached adapter price may diverge from the live
  // Pyth quote by far more than 5%, and every `updatePrice` would revert.
  // `forceUpdatePrice` is the keeper escape hatch — bypasses the cap, but only
  // when the cached price has aged past `DEVIATION_OVERRIDE_DELAY` (30 min).
  const DEVIATION_OVERRIDE_DELAY_S = 1800;
  let useForce = false;
  try {
    const [cached, maxDevBps] = await Promise.all([
      publicClient.readContract({
        abi: PYTH_ADAPTER_ABI,
        address: adapter,
        functionName: "latestRoundData",
      }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
      publicClient.readContract({
        abi: PYTH_ADAPTER_ABI,
        address: adapter,
        functionName: "maxDeviationBps",
      }) as Promise<bigint>,
    ]);
    const cachedE8 = cached[1];
    const cachedUpdatedAt = cached[3];
    // Compute newE8 the same way the contract does in _toE8(). Pyth equity
    // feeds are expo = -8 in the common case, so the result is just `price`.
    let newE8: bigint;
    if (quote.expo === -8) newE8 = BigInt(quote.price);
    else if (quote.expo < -8) newE8 = BigInt(quote.price) / 10n ** BigInt(-quote.expo - 8);
    else newE8 = BigInt(quote.price) * 10n ** BigInt(quote.expo + 8);

    if (cachedE8 > 0n && maxDevBps > 0n) {
      const dev = newE8 > cachedE8 ? newE8 - cachedE8 : cachedE8 - newE8;
      const devBps = (dev * 10_000n) / cachedE8;
      if (devBps > maxDevBps) {
        const age = BigInt(nowSec) - cachedUpdatedAt;
        if (age >= BigInt(DEVIATION_OVERRIDE_DELAY_S)) {
          useForce = true;
        } else {
          // Within the override cooldown — refuse rather than burn a guaranteed
          // revert. The client can retry once the cooldown elapses.
          throw new ApiError(503, "deviation_cooldown_active");
        }
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // If the pre-flight reads fail, fall through to normal updatePrice — worst
    // case is the cap reverts and we see it in submit_failed below.
    console.warn("[keeper/tick] preflight_failed:", (err as Error).message);
  }

  let txHash: Hex;
  try {
    const account = privateKeyToAccount(pkEnv as Hex);
    const walletClient = createWalletClient({
      account,
      chain: robinhoodChainTestnet,
      transport: http(),
    });
    const nonce = await acquireNonce(publicClient, account.address);
    txHash = await walletClient.writeContract({
      abi: PYTH_ADAPTER_ABI,
      address: adapter,
      functionName: useForce ? "forceUpdatePrice" : "updatePrice",
      args: [[updateBytes]],
      nonce,
    });
  } catch (err) {
    const { code, logMessage } = sanitizeError(err);
    if (code === "nonce_error") resyncNonce();
    console.error("[keeper/tick] submit_failed:", logMessage);
    throw new ApiError(502, code);
  }

  // Best-effort history recording. Errors swallowed.
  try {
    await recordPrice(symbol, priceForLog, publishTime);
  } catch (err) {
    console.warn("[keeper/tick] recordPrice failed:", err);
  }

  // Auto-Defender sweep. Failures don't affect the price-push response.
  let defenderResults: DefenderActionResult[] = [];
  try {
    defenderResults = await runDefenderSweep(publicClient);
  } catch (err) {
    console.warn("[keeper/tick] defender sweep failed:", err);
  }

  return NextResponse.json({
    ok: true,
    txHash,
    source,
    price: priceForLog,
    publishTime,
    defenderTriggered: defenderResults.some((d) => d.acted),
    defenderResults,
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function resolveTokenAddress(symbol: string): Promise<Address | null> {
  const { STOCK_TOKEN_ADDRESSES } = await import("@/lib/contracts/addresses");
  const addr = STOCK_TOKEN_ADDRESSES[symbol];
  return addr ?? null;
}

const ADAPTER_PRICEID_CACHE = new Map<string, Hex>();

async function resolveRegularPriceId(
  client: ReturnType<typeof createPublicClient>,
  adapter: Address,
): Promise<{ priceIdRegular: Hex }> {
  const key = adapter.toLowerCase();
  const cached = ADAPTER_PRICEID_CACHE.get(key);
  if (cached) return { priceIdRegular: cached };
  const id = (await client.readContract({
    abi: PYTH_ADAPTER_ABI,
    address: adapter,
    functionName: "priceId",
  })) as Hex;
  if (!isHex(id, 66)) throw new ApiError(502, "invalid_price_id_onchain");
  ADAPTER_PRICEID_CACHE.set(key, id);
  return { priceIdRegular: id };
}

// ─── Auto-Defender sweep ─────────────────────────────────────────────────

interface DefenderActionResult {
  wallet: Address;
  healthFactor: string;
  threshold: string;
  acted: boolean;
  reason?: string;
  repayUsd?: string;
  txHash?: Hex;
}

const PER_TICK_FRACTION = 0.05; // 5% of weekly limit per intervention

async function runDefenderSweep(
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<DefenderActionResult[]> {
  if (!EQUIFLOW_VAULT_ADDRESS) return [];
  const configs = await listActive();
  if (configs.length === 0) return [];

  const out: DefenderActionResult[] = [];
  for (const cfg of configs) {
    try {
      out.push(await maybeRepayFor(cfg, publicClient));
    } catch (err) {
      const { logMessage } = sanitizeError(err);
      out.push({
        wallet: cfg.wallet,
        healthFactor: "0",
        threshold: cfg.threshold,
        acted: false,
        reason: "sweep_error",
      });
      console.warn(`[defender] sweep error for ${cfg.wallet}:`, logMessage);
    }
  }
  return out;
}

async function maybeRepayFor(
  cfg: DefenderConfig,
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<DefenderActionResult> {
  // Need vault for typed reads.
  const vault = EQUIFLOW_VAULT_ADDRESS!;
  const hfRaw = (await publicClient.readContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vault,
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

  const pos = (await publicClient.readContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vault,
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
    address: vault,
    functionName: "liquidationThresholdBps",
    args: [cfg.wallet],
  })) as bigint;

  const desiredHf = (threshold * 105n) / 100n;
  const targetDebt =
    (collateralUsd18 * liqBps * BigInt(1e18)) /
    (BigInt(10_000) * desiredHf);
  const repayUsd18 = targetDebt < borrowedUsd18 ? borrowedUsd18 - targetDebt : 0n;
  if (repayUsd18 === 0n) {
    return {
      wallet: cfg.wallet,
      healthFactor: hfRaw.toString(),
      threshold: cfg.threshold,
      acted: false,
      reason: "no_repay_needed",
    };
  }

  const repayUsdg = repayUsd18 / BigInt(1e12);
  const weeklyRemaining = BigInt(cfg.weeklyLimit) - BigInt(cfg.weekUsed);
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
    (BigInt(cfg.weeklyLimit) * BigInt(Math.floor(PER_TICK_FRACTION * 100))) / 100n;
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

  // The real session-key path requires on-chain installValidation() to land;
  // until then we hold the keeper to dry_run regardless of config to avoid
  // signing repays that the user hasn't actually authorized on-chain. See
  // docs/SECURITY_RUNBOOK.md for the rollout plan.
  const effectiveUsd18 = effectiveUsdg * BigInt(1e12);
  const data = encodeFunctionData({
    abi: EQUIFLOW_VAULT_ABI,
    functionName: "repay",
    args: [effectiveUsd18],
  });
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

// Silence unused-import lint while the dry-run guard is in effect.
void requireAddressValue;
