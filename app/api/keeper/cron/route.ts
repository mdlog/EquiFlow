import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
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
import { fetchFreshestPyth, validatePythQuote } from "@/lib/web3/hermes";
import { EQUIFLOW_VAULT_ABI, EQUIFLOW_VAULT_ADDRESS } from "@/lib/contracts";
import { STOCK_TOKEN_ADDRESSES } from "@/lib/contracts";
import { recordPrice } from "@/lib/web3/price-history";
import { acquireNonce, resyncNonce } from "@/lib/web3/keeper-nonce";
import {
  requireBearerSecret,
  requireRateLimit,
  sanitizeError,
} from "@/lib/api/security";
import { ApiError, withErrorHandler } from "@/lib/api/handler";

/// Cron-friendly keeper sweep.
///
/// Unlike /api/keeper/tick (one adapter per call, JSON-bodied, browser-driven),
/// this route does the full sweep server-side: discovers every listed asset,
/// resolves its adapter, fetches the freshest Pyth quote, and signs+pushes
/// updatePrice() in a tight loop. One GET = whole vault fresh.
///
/// Designed for Vercel Cron (`vercel.json` → `crons: [{path: "/api/keeper/cron"}]`)
/// and external schedulers (cron-job.org, GitHub Actions, etc).
///
/// Authentication:
///   - If CRON_SECRET is set, requests must include
///     `Authorization: Bearer <CRON_SECRET>`.
///   - Vercel Cron automatically injects this header when CRON_SECRET is
///     defined in project env, so no extra setup needed.
///   - If unset (local dev), endpoint is open — gate by network or auth in
///     front of the deploy if exposed publicly.
///
/// Response:
///   {
///     ok: true,
///     summary: { ticked, failed, skipped },
///     results: [{ symbol, adapter, source, price, txHash, error }]
///   }

const PK_RE = /^0x[0-9a-fA-F]{64}$/;

interface TickResult {
  symbol: string;
  token: Address;
  adapter: Address;
  source: "pyth";
  price: number;
  publishTime: number;
  txHash?: Hex;
  error?: string;
  skipped?: string;
}

/// Reverse map token → symbol so we can derive the registered priceId from
/// the on-chain asset list. Built once per worker.
const TOKEN_TO_SYMBOL = new Map<string, string>();
for (const [sym, addr] of Object.entries(STOCK_TOKEN_ADDRESSES)) {
  if (addr) TOKEN_TO_SYMBOL.set(addr.toLowerCase(), sym);
}

export const GET = withErrorHandler(async (req: Request) => {
  // Bearer auth — timing-safe compare, fail-closed in production.
  requireBearerSecret(req, "CRON_SECRET");

  // Depth-defense rate limit on top of bearer auth. Vercel cron fires once
  // every 2 minutes (~30/h), so 12/min per IP leaves wide headroom for legit
  // traffic but caps damage from a leaked secret or a preview-URL exposure.
  await requireRateLimit(req, { bucket: "cron-keeper", windowSeconds: 60, max: 12 });

  const pk = process.env.KEEPER_PRIVATE_KEY;
  if (!pk || !PK_RE.test(pk)) throw new ApiError(503, "keeper_disabled");
  if (!EQUIFLOW_VAULT_ADDRESS) throw new ApiError(503, "vault_not_configured");
  const vault = EQUIFLOW_VAULT_ADDRESS;

  const publicClient = createPublicClient({
    chain: robinhoodChainTestnet,
    transport: http(),
  });
  const account = privateKeyToAccount(pk as Hex);
  const walletClient = createWalletClient({
    account,
    chain: robinhoodChainTestnet,
    transport: http(),
  });

  // ── 1. Discover listed assets ───────────────────────────────────────────
  let tokens: readonly Address[];
  try {
    tokens = (await publicClient.readContract({
      abi: EQUIFLOW_VAULT_ABI,
      address: vault,
      functionName: "listedAssets",
    })) as readonly Address[];
  } catch (err) {
    const { code, logMessage } = sanitizeError(err);
    console.error("[keeper/cron] listed_assets_failed:", logMessage);
    throw new ApiError(502, code);
  }

  // ── 2. Resolve adapter per token ───────────────────────────────────────
  // RBN testnet's Multicall at 0xa432...7a8 is v1/v2 (no aggregate3), so
  // viem's multicall() throws. Use parallel readContract() instead — slower
  // by one RTT per asset but works everywhere.
  const assetReads = await Promise.all(
    tokens.map(async (t) => {
      try {
        const result = await publicClient.readContract({
          abi: EQUIFLOW_VAULT_ABI,
          address: vault,
          functionName: "assets",
          args: [t],
        });
        return { status: "success" as const, result };
      } catch (err) {
        return {
          status: "failure" as const,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }),
  );

  // ── 3. Per-asset: fetch quote, encode, send updatePrice ────────────────
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;
  const results: TickResult[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const assetCfg = assetReads[i];
    if (!token || !assetCfg) continue;
    const symbol = TOKEN_TO_SYMBOL.get(token.toLowerCase());

    if (!symbol) {
      results.push({
        symbol: "?",
        token,
        adapter: ZERO_ADDR,
        source: "pyth",
        price: 0,
        publishTime: 0,
        skipped: "unknown_token",
      });
      continue;
    }
    if (assetCfg.status !== "success") {
      results.push({
        symbol,
        token,
        adapter: ZERO_ADDR,
        source: "pyth",
        price: 0,
        publishTime: 0,
        error: "assets_read_failed",
      });
      continue;
    }
    const [adapter, , , , enabled] = assetCfg.result as readonly [
      Address,
      bigint,
      bigint,
      bigint,
      boolean,
    ];
    if (!enabled) {
      results.push({
        symbol,
        token,
        adapter,
        source: "pyth",
        price: 0,
        publishTime: 0,
        skipped: "asset_disabled",
      });
      continue;
    }

    const priceId = PYTH_PRICE_IDS[symbol];
    if (!priceId) {
      results.push({
        symbol,
        token,
        adapter,
        source: "pyth",
        price: 0,
        publishTime: 0,
        skipped: "no_price_id",
      });
      continue;
    }

    // Fetch the freshest Pyth quote. If Hermes is unavailable or returns a
    // quote that fails freshness/confidence checks, SKIP this symbol — never
    // fall back to fabricated prices. A stale or fake on-chain price would
    // distort health-factor / LTV checks at the vault level.
    const quote = await fetchFreshestPyth(symbol);
    const nowSec = Math.floor(Date.now() / 1000);

    if (!quote) {
      results.push({
        symbol,
        token,
        adapter,
        source: "pyth",
        price: 0,
        publishTime: 0,
        skipped: "hermes_unavailable",
      });
      continue;
    }

    const validation = validatePythQuote(quote, nowSec);
    if (!validation.ok) {
      console.warn(
        `[keeper/cron] quote_rejected sym=${symbol} reason=${validation.reason} ` +
          `age=${validation.ageSeconds}s conf=${validation.confBps}bps`,
      );
      results.push({
        symbol,
        token,
        adapter,
        source: "pyth",
        price: 0,
        publishTime: 0,
        skipped: `quote_${validation.reason}`,
      });
      continue;
    }

    const priceForLog = Number(quote.price) / 10 ** -quote.expo;
    // On-chain publishTime is the server's "I attest this submission is fresh"
    // timestamp. validatePythQuote() above already guarantees the underlying
    // Hermes publish_time is within MAX_PUBLISH_AGE_SECONDS of now.
    const publishTime = nowSec;
    const updateBytes: Hex = craftMockPythUpdate({
      priceId,
      price: quote.price,
      expo: quote.expo,
      publishTime,
      conf: quote.conf,
    });
    const source: "pyth" = "pyth";

    try {
      const nonce = await acquireNonce(publicClient, account.address);
      const txHash = await walletClient.writeContract({
        abi: PYTH_ADAPTER_ABI,
        address: adapter,
        functionName: "updatePrice",
        args: [[updateBytes]],
        nonce,
      });
      await recordPrice(symbol, priceForLog, publishTime);
      results.push({
        symbol,
        token,
        adapter,
        source,
        price: priceForLog,
        publishTime,
        txHash,
      });
    } catch (err) {
      const { code, logMessage } = sanitizeError(err);
      if (code === "nonce_error") resyncNonce();
      console.error(`[keeper/cron] write_failed sym=${symbol}:`, logMessage);
      results.push({
        symbol,
        token,
        adapter,
        source,
        price: priceForLog,
        publishTime,
        error: code,
      });
    }
  }

  const ticked = results.filter((r) => r.txHash).length;
  const failed = results.filter((r) => r.error).length;
  const skipped = results.filter((r) => r.skipped).length;

  return NextResponse.json({
    ok: true,
    summary: { ticked, failed, skipped, total: results.length },
    results,
  });
});
