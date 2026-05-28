import { type Address, type PublicClient } from "viem";
import { EQUIFLOW_VAULT_ABI, EQUIFLOW_VAULT_ADDRESS } from "@/lib/contracts";
import { PYTH_PRICE_IDS_BY_SESSION, PYTH_PRICE_IDS } from "@/lib/web3/pyth";
import { STOCK_TOKEN_ADDRESSES } from "@/lib/contracts";

/// Cached allowlist of (adapter, priceId) tuples derived from the on-chain
/// listedAssets() roster plus the registered PYTH_PRICE_IDS table. Used by
/// /api/keeper/tick to refuse caller-supplied destinations that the keeper
/// has no business touching.

interface CacheEntry {
  adapters: Set<string>; // lowercased adapter addresses
  priceIds: Set<string>; // lowercased priceIds (regular + per-session)
  fetchedAtMs: number;
}

const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;

const TOKEN_TO_SYMBOL = new Map<string, string>();
for (const [sym, addr] of Object.entries(STOCK_TOKEN_ADDRESSES)) {
  if (addr) TOKEN_TO_SYMBOL.set(addr.toLowerCase(), sym);
}

async function refresh(client: PublicClient): Promise<CacheEntry> {
  const adapters = new Set<string>();
  const priceIds = new Set<string>();

  // Seed priceIds from the in-process table (regular + sessions) so attacker
  // can't push to a session priceId that isn't in our registry.
  for (const id of Object.values(PYTH_PRICE_IDS)) priceIds.add(id.toLowerCase());
  for (const sessions of Object.values(PYTH_PRICE_IDS_BY_SESSION)) {
    for (const id of Object.values(sessions)) priceIds.add(id.toLowerCase());
  }

  if (!EQUIFLOW_VAULT_ADDRESS) {
    return { adapters, priceIds, fetchedAtMs: Date.now() };
  }
  const vault: Address = EQUIFLOW_VAULT_ADDRESS;
  const tokens = (await client.readContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vault,
    functionName: "listedAssets",
  })) as readonly Address[];

  await Promise.all(
    tokens.map(async (t) => {
      try {
        const result = (await client.readContract({
          abi: EQUIFLOW_VAULT_ABI,
          address: vault,
          functionName: "assets",
          args: [t],
        })) as readonly [Address, bigint, bigint, bigint, boolean];
        const [adapter] = result;
        if (adapter && adapter !== "0x0000000000000000000000000000000000000000") {
          adapters.add(adapter.toLowerCase());
        }
      } catch {
        // ignore — one bad asset doesn't poison the whole allowlist
      }
    }),
  );

  return { adapters, priceIds, fetchedAtMs: Date.now() };
}

export async function getVaultAllowlist(client: PublicClient): Promise<CacheEntry> {
  const now = Date.now();
  if (cache && now - cache.fetchedAtMs < CACHE_TTL_MS) return cache;
  cache = await refresh(client);
  return cache;
}

export function invalidateAllowlist(): void {
  cache = null;
}

export function symbolForToken(token: Address): string | undefined {
  return TOKEN_TO_SYMBOL.get(token.toLowerCase());
}
