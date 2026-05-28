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
import { fetchFreshestPyth } from "@/lib/web3/hermes";
import { EQUIFLOW_VAULT_ABI, EQUIFLOW_VAULT_ADDRESS } from "@/lib/contracts";
import { STOCK_TOKEN_ADDRESSES } from "@/lib/contracts";
import { STOCKS } from "@/lib/config/stocks";
import { recordPrice } from "@/lib/web3/price-history";
import { acquireNonce, resyncNonce } from "@/lib/web3/keeper-nonce";
import { requireBearerSecret, sanitizeError } from "@/lib/api/security";
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
  source: "pyth" | "mock";
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

const STOCK_BY_SYM = new Map(STOCKS.map((s) => [s.sym, s]));

export const GET = withErrorHandler(async (req: Request) => {
  // Bearer auth — timing-safe compare, fail-closed in production.
  requireBearerSecret(req, "CRON_SECRET");

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
  const results: TickResult[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const symbol = TOKEN_TO_SYMBOL.get(token.toLowerCase());
    const meta = STOCK_BY_SYM.get(symbol ?? "");
    const assetCfg = assetReads[i];

    if (!symbol || !meta) {
      results.push({
        symbol: symbol ?? "?",
        token,
        adapter: "0x0000000000000000000000000000000000000000" as Address,
        source: "mock",
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
        adapter: "0x0000000000000000000000000000000000000000" as Address,
        source: "mock",
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
        source: "mock",
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
        source: "mock",
        price: 0,
        publishTime: 0,
        skipped: "no_price_id",
      });
      continue;
    }

    // Fetch fresh Pyth quote (preferred) or fall back to a random walk
    const quote = await fetchFreshestPyth(symbol);
    const nowSec = Math.floor(Date.now() / 1000);

    let priceForLog: number;
    let updateBytes: Hex;
    let source: "pyth" | "mock";
    let publishTime: number;

    if (quote) {
      priceForLog = Number(quote.price) / 10 ** -quote.expo;
      // Use server `now` rather than Hermes publishTime — adapter staleAfter
      // is measured against block.timestamp on RBN, and Hermes may be a few
      // seconds behind. Using `now` maximises the freshness window.
      publishTime = nowSec;
      updateBytes = craftMockPythUpdate({
        priceId,
        price: quote.price,
        expo: quote.expo,
        publishTime,
      });
      source = "pyth";
    } else {
      const delta = (Math.random() - 0.5) * 2 * meta.volatility * meta.price;
      priceForLog = Math.max(meta.price + delta, 0.01);
      publishTime = nowSec;
      updateBytes = craftMockPythUpdate({
        priceId,
        price: BigInt(Math.round(priceForLog * 1e8)),
        expo: -8,
        publishTime,
      });
      source = "mock";
    }

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
