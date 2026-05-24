import { NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { robinhoodChainTestnet } from "@/lib/config/chain";
import { PYTH_ADAPTER_ABI } from "@/lib/web3/pyth";
import { EQUIFLOW_VAULT_ABI, EQUIFLOW_VAULT_ADDRESS } from "@/lib/contracts";
import { STOCK_TOKEN_ADDRESSES } from "@/lib/contracts";

/// Public healthcheck for the keeper.
///
/// Returns each adapter's last on-chain `updatedAt` timestamp, computed
/// `ageSeconds` from server `now`, and a `stale` flag. Anything `stale: true`
/// means `positionOf()` / `healthFactor()` will revert with StalePrice for
/// any user holding that token as collateral.
///
/// Wire to UptimeRobot / Better Stack with a JSON body check like:
///   $.stale = false
/// to get paged when the keeper bot stops ticking.
///
/// No auth — read-only and safe to expose. The information is already public
/// (anyone can call latestRoundData on the adapters directly).

interface AdapterHealth {
  symbol: string;
  token: Address;
  adapter: Address;
  staleAfter: number; // seconds, configured on vault per asset
  updatedAt: number; // unix seconds from adapter
  ageSeconds: number; // now - updatedAt
  stale: boolean;
  enabled: boolean;
}

const TOKEN_TO_SYMBOL = new Map<string, string>();
for (const [sym, addr] of Object.entries(STOCK_TOKEN_ADDRESSES)) {
  if (addr) TOKEN_TO_SYMBOL.set(addr.toLowerCase(), sym);
}

export async function GET() {
  try {
    if (!EQUIFLOW_VAULT_ADDRESS) {
      return NextResponse.json(
        { ok: false, error: "vault_not_configured" },
        { status: 503 },
      );
    }
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
      return NextResponse.json(
        {
          ok: false,
          error: "listed_assets_failed",
          detail: err instanceof Error ? err.message.slice(0, 240) : String(err),
        },
        { status: 502 },
      );
    }

    // RBN testnet's Multicall at 0xa432...7a8 is v1/v2 only (no aggregate3),
    // so viem's multicall() throws on this chain. Use parallel readContract
    // calls instead — N RTTs but works everywhere.
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
        } catch (err) {
          return {
            status: "failure" as const,
            error: err instanceof Error ? err.message : String(err),
          };
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
        const tuple = r.result as readonly [
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
        ];
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
      {
        headers: {
          "Cache-Control": "public, max-age=10, s-maxage=10",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[keeper:health] unhandled:", msg);
    return NextResponse.json(
      { ok: false, error: "health_failed", detail: msg.slice(0, 240) },
      { status: 500 },
    );
  }
}
