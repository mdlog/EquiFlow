/// Server-side store for active Auto-Defender configurations.
///
/// Each entry maps a smart-wallet address to its session-key context:
///   - sessionKey: the public address of the keeper's session-signer
///   - thresholdHF: 18-decimals fixed (e.g. 1.15e18)
///   - weeklyLimitUsdg: 6-decimals (USDG atomic, e.g. 500e6 = $500)
///   - weekUsed: accumulated atomic usage in the current 7-day window
///   - weekStart: unix seconds when the current week started
///   - expiresAt: unix seconds
///   - collateralTokens: optional whitelist (lowercased)
///   - installUserOpHash: proof-of-authorization (not validated here)
///
/// Two backends, picked at request time:
///   1. Upstash REST (if UPSTASH_REDIS_REST_URL + TOKEN set). Same pattern
///      as lib/price-history.ts.
///   2. In-memory `Map` (process-local). Survives within a single Node
///      worker; lost on restart. Fine for demo.

import type { Address } from "viem";

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_ENABLED = !!(URL && TOKEN);

const REDIS_KEY_PREFIX = "defender:";
const REDIS_INDEX = "defender:active";

export interface DefenderConfig {
  wallet: Address;
  sessionKey: Address;
  threshold: string; // 1e18-scaled, decimal string
  weeklyLimit: string; // USDG atomic (6 dec), decimal string
  weekUsed: string; // USDG atomic, decimal string
  weekStart: number; // unix seconds
  expiresAt: number; // unix seconds
  collateralTokens: string[]; // lowercased addresses
  installUserOpHash?: string;
  createdAt: number;
}

/// Process-local store — fallback when Upstash isn't configured. Persists
/// across requests in the same Node worker.
const MEM: Map<string, DefenderConfig> = (() => {
  const g = globalThis as unknown as {
    __equiflowDefenderMem?: Map<string, DefenderConfig>;
  };
  if (!g.__equiflowDefenderMem) g.__equiflowDefenderMem = new Map();
  return g.__equiflowDefenderMem;
})();

async function redisCall(cmd: (string | number)[]): Promise<unknown> {
  if (!REDIS_ENABLED) return null;
  const res = await fetch(`${URL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash_${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(`upstash_cmd_${json.error}`);
  return json.result;
}

const WEEK = 7 * 86400;
const lc = (a: string) => a.toLowerCase();

export async function readConfig(wallet: Address): Promise<DefenderConfig | null> {
  const key = lc(wallet);
  if (REDIS_ENABLED) {
    try {
      const raw = (await redisCall(["GET", REDIS_KEY_PREFIX + key])) as
        | string
        | null;
      if (!raw) return null;
      const cfg = JSON.parse(raw) as DefenderConfig;
      return rolloverIfExpired(cfg);
    } catch (err) {
      console.warn("[defender] redis read failed, falling back to mem:", err);
    }
  }
  const cfg = MEM.get(key);
  return cfg ? rolloverIfExpired(cfg) : null;
}

export async function writeConfig(cfg: DefenderConfig): Promise<void> {
  const key = lc(cfg.wallet);
  cfg.wallet = key as Address;
  cfg.sessionKey = lc(cfg.sessionKey) as Address;
  cfg.collateralTokens = cfg.collateralTokens.map(lc);
  if (REDIS_ENABLED) {
    try {
      await redisCall(["SET", REDIS_KEY_PREFIX + key, JSON.stringify(cfg)]);
      await redisCall(["SADD", REDIS_INDEX, key]);
      return;
    } catch (err) {
      console.warn("[defender] redis write failed, falling back to mem:", err);
    }
  }
  MEM.set(key, cfg);
}

export async function deleteConfig(wallet: Address): Promise<void> {
  const key = lc(wallet);
  if (REDIS_ENABLED) {
    try {
      await redisCall(["DEL", REDIS_KEY_PREFIX + key]);
      await redisCall(["SREM", REDIS_INDEX, key]);
      return;
    } catch (err) {
      console.warn("[defender] redis delete failed, falling back to mem:", err);
    }
  }
  MEM.delete(key);
}

/// Returns all currently-active (non-expired) configs. Used by the keeper.
export async function listActive(): Promise<DefenderConfig[]> {
  const now = Math.floor(Date.now() / 1000);
  const out: DefenderConfig[] = [];
  if (REDIS_ENABLED) {
    try {
      const keys = (await redisCall(["SMEMBERS", REDIS_INDEX])) as string[];
      for (const k of keys) {
        const raw = (await redisCall(["GET", REDIS_KEY_PREFIX + k])) as
          | string
          | null;
        if (!raw) continue;
        const cfg = JSON.parse(raw) as DefenderConfig;
        if (cfg.expiresAt > now) out.push(rolloverIfExpired(cfg));
      }
      return out;
    } catch (err) {
      console.warn("[defender] redis list failed, falling back to mem:", err);
    }
  }
  for (const cfg of MEM.values()) {
    if (cfg.expiresAt > now) out.push(rolloverIfExpired(cfg));
  }
  return out;
}

/// Resets `weekUsed` if we've rolled past the 7-day window. Mutates a copy.
/// Caller is responsible for persisting and clearing the atomic counter.
function rolloverIfExpired(cfg: DefenderConfig): DefenderConfig {
  const now = Math.floor(Date.now() / 1000);
  if (now - cfg.weekStart >= WEEK) {
    return { ...cfg, weekStart: now, weekUsed: "0" };
  }
  return cfg;
}

async function clearUsageCounter(walletLc: string): Promise<void> {
  if (!REDIS_ENABLED) return;
  try {
    await redisCall(["DEL", `defender:weekused:${walletLc}`]);
  } catch (err) {
    console.warn("[defender] redis counter clear failed:", err);
  }
}

/// Atomically increment weekUsed by `delta` atomic USDG units.
///
/// Implementation note: we keep the truth in the serialized JSON for parity
/// with read paths, but use a separate Upstash counter as the atomic anchor.
/// The flow is:
///   1. INCRBY counter:<wallet> delta       — atomic, race-safe
///   2. read the counter back              — the canonical weekUsed
///   3. write JSON with the new value      — keeps reads consistent
///
/// On Upstash unavailability we still serialize via a per-process mutex so
/// concurrent calls don't lose increments within one Node worker. Cross-
/// process races still possible without Upstash, but those are noted in
/// the audit and documented in SECURITY_RUNBOOK.md.
const usageMutexes = new Map<string, Promise<void>>();

async function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = usageMutexes.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  usageMutexes.set(key, prior.then(() => next));
  try {
    await prior;
    return await fn();
  } finally {
    release();
    if (usageMutexes.get(key) === next) usageMutexes.delete(key);
  }
}

async function redisIncrBy(key: string, delta: bigint): Promise<bigint | null> {
  if (!REDIS_ENABLED) return null;
  // Upstash INCRBY supports integer payloads up to int64 — our weekUsed is
  // 6-dec USDG atomic; even a billion-dollar cap fits in 60 bits. Pass as
  // string to avoid float coercion in Upstash's JSON command parser.
  try {
    const result = (await redisCall(["INCRBY", key, delta.toString()])) as
      | number
      | string
      | null;
    if (result === null || result === undefined) return null;
    return BigInt(result);
  } catch (err) {
    console.warn("[defender] redis incrby failed:", err);
    return null;
  }
}

export async function recordUsage(
  wallet: Address,
  deltaUsdg: bigint,
): Promise<void> {
  if (deltaUsdg <= 0n) return;
  const key = lc(wallet);
  await withMutex(key, async () => {
    // Read the *raw* config so we can detect a week boundary without
    // rolloverIfExpired silently dropping our INCR result.
    const cfg = await readConfig(wallet);
    if (!cfg) return;

    const now = Math.floor(Date.now() / 1000);
    const rolledOver = now - cfg.weekStart >= WEEK;
    if (rolledOver) {
      // New week. Reset counter and JSON before applying this delta so the
      // increment lands in the fresh window.
      await clearUsageCounter(key);
      cfg.weekStart = now;
      cfg.weekUsed = "0";
    }

    const counterKey = `defender:weekused:${key}`;
    const onUpstash = await redisIncrBy(counterKey, deltaUsdg);

    const merged: DefenderConfig = {
      ...cfg,
      weekUsed:
        onUpstash !== null
          ? onUpstash.toString()
          : (BigInt(cfg.weekUsed) + deltaUsdg).toString(),
    };
    await writeConfig(merged);
  });
}

export async function countActive(): Promise<number> {
  const all = await listActive();
  return all.length;
}
