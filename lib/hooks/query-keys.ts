import type { Address } from "viem";

/// Centralised TanStack Query key factory for EquiFlow. Every cached
/// fetch outside of wagmi (which derives its own keys from contract/address)
/// should route through here so:
///   1. We can invalidate by namespace (e.g. all position data after a tx)
///     without invalidating wagmi's internal sparkline/history caches.
///   2. Keys remain scoped to (chainId, vault, user) — avoids cross-account
///     bleed when a second user signs in on the same browser session.
///   3. A single mental model exists for "what's the key for X" instead of
///     reinventing it per hook.
///
/// Usage:
///   useQuery({ queryKey: qk.position(chainId, vault, user), ... });
///   queryClient.invalidateQueries({
///     predicate: (q) => qk.matches.position(q.queryKey),
///   });

const NAMESPACE = "equiflow" as const;

export const qk = {
  hermes: (symbols: readonly string[]) =>
    [NAMESPACE, "hermes", [...symbols].sort().join(",")] as const,
  ethPrice: () => [NAMESPACE, "price", "ETH/USD"] as const,
  marketHistory: (sym: string, days: number, res: string) =>
    [NAMESPACE, "market-history", sym, days, res] as const,
  marketSparkline: (key: string) =>
    [NAMESPACE, "market-sparkline", key] as const,
  markets24h: (key: string) => [NAMESPACE, "markets-24h", key] as const,
  position: (chainId: number, vault: Address, user: Address) =>
    [NAMESPACE, "position", chainId, vault, user] as const,
  positionEvents: (
    chainId: number,
    vault: Address,
    user: Address,
    bucket: bigint,
  ) =>
    [
      NAMESPACE,
      "position-events",
      chainId,
      vault,
      user,
      bucket.toString(),
    ] as const,
  recentLiquidations: (vault: Address, bucket: bigint) =>
    [
      NAMESPACE,
      "recent-liquidations",
      vault,
      bucket.toString(),
    ] as const,
  protocolStats: (vault: Address) =>
    [NAMESPACE, "protocol-stats", vault] as const,
  defenderStatus: (user: Address) =>
    [NAMESPACE, "defender-status", user] as const,
  sessionInfo: (user: Address) =>
    [NAMESPACE, "session-info", user] as const,
} as const;

/// Predicates for `queryClient.invalidateQueries({ predicate: ... })`.
/// Use these instead of stringly matching key shape.
export const qkMatches = {
  /// Match any namespaced EquiFlow query (excludes wagmi's internal keys).
  any: (key: readonly unknown[]) => key[0] === NAMESPACE,
  /// Match any position-related query for `(chainId, vault, user)`.
  position: (key: readonly unknown[]) =>
    key[0] === NAMESPACE &&
    (key[1] === "position" || key[1] === "position-events"),
  /// Match anything that should refresh after a write tx — position state,
  /// protocol-wide stats, and recent events.
  postTx: (key: readonly unknown[]) =>
    key[0] === NAMESPACE &&
    (key[1] === "position" ||
      key[1] === "position-events" ||
      key[1] === "protocol-stats" ||
      key[1] === "recent-liquidations"),
} as const;
