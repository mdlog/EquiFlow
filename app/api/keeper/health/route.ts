import { NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { robinhoodChainTestnet } from "@/lib/config/chain";
import { PYTH_ADAPTER_ABI } from "@/lib/web3/pyth";
import { EQUIFLOW_VAULT_ABI, EQUIFLOW_VAULT_ADDRESS } from "@/lib/contracts";
import { STOCK_TOKEN_ADDRESSES } from "@/lib/contracts";
import { ApiError, withErrorHandler } from "@/lib/api/handler";
import { requireRateLimit, sanitizeError } from "@/lib/api/security";

// Public healthcheck for the keeper. Read-only. Rate-limited per IP so an
// attacker can't use it as a free signal to time exploit attempts.

interface AdapterHealth {
  symbol: string;
  token: Address;
  adapter: Address;
  staleAfter: number;
  updatedAt: number;
  ageSeconds: number;
  stale: boolean;
  enabled: boolean;
}

const TOKEN_TO_SYMBOL = new Map<string, string>();
for (const [sym, addr] of Object.entries(STOCK_TOKEN_ADDRESSES)) {
  if (addr) TOKEN_TO_SYMBOL.set(addr.toLowerCase(), sym);
}

export const GET = withErrorHandler(async (req: Request) => {
  await requireRateLimit(req, { bucket: "keeper-health", max: 30, windowSeconds: 60 });
  if (!EQUIFLOW_VAULT_ADDRESS) throw new ApiError(503, "vault_not_configured");
  const vault = EQUIFLOW_VAULT_ADDRESS;

  const client = createPublicClient({
    chain: robinhoodChainTestnet,
    transport: http(),
  });

  let tokens: readonly Address[];
  try {
    tokens = (await client.readContract({
      abi: EQUIFLOW_VAULT_ABI,
      address: vault,
      functionName: "listedAssets",
    })) as readonly Address[];
  } catch (err) {
    const { code, logMessage } = sanitizeError(err);
    console.error("[keeper/health] listed_assets:", logMessage);
    throw new ApiError(502, code);
  }

  const assetReads = await Promise.all(
    tokens.map(async (t) => {
      try {
        const result = await client.readContract({
          abi: EQUIFLOW_VAULT_ABI,
          address: vault,
          functionName: "assets",
          args: [t],
        });
        return { status: "success" as const, result };
      } catch {
        return { status: "failure" as const };
      }
    }),
  );

  type AssetTuple = readonly [Address, bigint, bigint, bigint, boolean];
  const adapters: Array<{
    token: Address;
    adapter: Address;
    staleAfter: number;
    enabled: boolean;
  }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const r = assetReads[i];
    if (r.status !== "success") continue;
    const [adapter, , , staleAfter, enabled] = r.result as AssetTuple;
    adapters.push({
      token: tokens[i],
      adapter,
      staleAfter: Number(staleAfter),
      enabled,
    });
  }

  const rounds = await Promise.all(
    adapters.map(async (a) => {
      try {
        const result = await client.readContract({
          abi: PYTH_ADAPTER_ABI,
          address: a.adapter,
          functionName: "latestRoundData",
        });
        return { status: "success" as const, result };
      } catch {
        return { status: "failure" as const };
      }
    }),
  );

  const now = Math.floor(Date.now() / 1000);
  const health: AdapterHealth[] = [];
  for (let i = 0; i < adapters.length; i++) {
    const a = adapters[i];
    const r = rounds[i];
    let updatedAt = 0;
    if (r.status === "success") {
      const tuple = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
      updatedAt = Number(tuple[3]);
    }
    const age = updatedAt > 0 ? now - updatedAt : Number.MAX_SAFE_INTEGER;
    health.push({
      symbol: TOKEN_TO_SYMBOL.get(a.token.toLowerCase()) ?? "?",
      token: a.token,
      adapter: a.adapter,
      staleAfter: a.staleAfter,
      updatedAt,
      ageSeconds: age,
      stale: age >= a.staleAfter,
      enabled: a.enabled,
    });
  }

  const anyStale = health.some((h) => h.enabled && h.stale);
  const lastUpdate = health.reduce(
    (max, h) => (h.updatedAt > max ? h.updatedAt : max),
    0,
  );

  return NextResponse.json(
    {
      ok: true,
      stale: anyStale,
      now,
      lastUpdate,
      adapters: health,
    },
    { headers: { "Cache-Control": "public, max-age=10, s-maxage=10" } },
  );
});
