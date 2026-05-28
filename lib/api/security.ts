import { timingSafeEqual, randomBytes } from "node:crypto";
import {
  type Address,
  type Hex,
  type PublicClient,
  hashTypedData,
  recoverAddress,
  isAddress,
} from "viem";
import { ApiError } from "./handler";

// Shared server-side security primitives.
//
// All helpers are designed to fail closed and to produce STABLE error codes
// (never leak internal viem/RPC error messages to the client). Keep this file
// dependency-light — only viem + node built-ins.

// ─── Body size cap ─────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 16 * 1024; // 16 KiB — every legitimate body here is < 4 KiB

export function enforceBodySize(req: Request): void {
  const lenHeader = req.headers.get("content-length");
  if (!lenHeader) return; // streamed body — handled by readJsonBody bytecount fallback below
  const n = Number(lenHeader);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, "invalid_content_length");
  if (n > MAX_BODY_BYTES) throw new ApiError(413, "body_too_large");
}

export async function readBoundedJson<T>(req: Request): Promise<T> {
  enforceBodySize(req);
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new ApiError(400, "invalid_body");
  }
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "body_too_large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(400, "invalid_json");
  }
}

// ─── Bearer auth (timing-safe) ─────────────────────────────────────────────

function constEqString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Still do a timingSafeEqual against a same-length scratch buffer to mask
    // the length-mismatch branch a bit. Not a true defense (we still leak via
    // total wall time), but better than `aBuf.length !== bBuf.length && return`.
    const scratch = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, scratch);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/// Returns the bearer token part of an Authorization header, or null if the
/// header is missing or doesn't use the Bearer scheme. The scheme comparison
/// is case-insensitive (RFC 6750 §2.1), the token returned as-is for
/// timing-safe comparison.
function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const sp = header.indexOf(" ");
  if (sp < 0) return null;
  const scheme = header.slice(0, sp);
  if (scheme.toLowerCase() !== "bearer") return null;
  return header.slice(sp + 1);
}

export function requireBearerSecret(req: Request, envVar: string): void {
  const expected = process.env[envVar];
  if (!expected) {
    // Fail closed whenever a privileged signer key is also configured. Without
    // CRON_SECRET, anyone reaching the dev server can burn keeper gas — even
    // in NODE_ENV=development. Documented in .env.example.
    if (process.env.KEEPER_PRIVATE_KEY) {
      throw new ApiError(503, "cron_secret_required");
    }
    if (process.env.NODE_ENV === "production") {
      throw new ApiError(503, "secret_not_configured");
    }
    return; // dev convenience, only when no signing key is configured
  }
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) throw new ApiError(401, "unauthorized");
  if (!constEqString(token, expected)) throw new ApiError(401, "unauthorized");
}

// ─── EIP-712 signature verification ────────────────────────────────────────
//
// Verifies BOTH EOA (ECDSA) and smart-account (ERC-1271 isValidSignature)
// signatures. Use this on every endpoint that takes an authenticated action
// on behalf of a wallet (defender register/revoke, etc).

const ERC1271_MAGIC: Hex = "0x1626ba7e";
const ERC1271_ABI = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ type: "bytes4" }],
  },
] as const;

export interface VerifyTypedDataOpts {
  publicClient: PublicClient;
  expectedSigner: Address;
  hash: Hex;
  signature: Hex;
}

async function isValidEoaSig(
  hash: Hex,
  signature: Hex,
  expectedSigner: Address,
): Promise<boolean> {
  try {
    const recovered = await recoverAddress({ hash, signature });
    return recovered.toLowerCase() === expectedSigner.toLowerCase();
  } catch {
    return false;
  }
}

async function isValidErc1271Sig({
  publicClient,
  expectedSigner,
  hash,
  signature,
}: VerifyTypedDataOpts): Promise<boolean> {
  try {
    const code = await publicClient.getCode({ address: expectedSigner });
    if (!code || code === "0x") return false;
    const ret = (await publicClient.readContract({
      abi: ERC1271_ABI,
      address: expectedSigner,
      functionName: "isValidSignature",
      args: [hash, signature],
    })) as Hex;
    return ret.toLowerCase() === ERC1271_MAGIC;
  } catch {
    return false;
  }
}

export async function verifySignature(opts: VerifyTypedDataOpts): Promise<boolean> {
  if (await isValidEoaSig(opts.hash, opts.signature, opts.expectedSigner)) return true;
  if (await isValidErc1271Sig(opts)) return true;
  return false;
}

// EquiFlow-specific EIP-712 domain. Pin chainId to the only chain we accept.
// Use the same domain across defender register/revoke/etc to prevent any
// cross-action signature replay.
export function defenderDomain(chainId: number, verifyingContract: Address) {
  return {
    name: "EquiFlow Defender",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

export const DEFENDER_REGISTER_TYPES = {
  DefenderRegister: [
    { name: "wallet", type: "address" },
    { name: "sessionKey", type: "address" },
    { name: "weeklyLimitUsdg", type: "uint256" },
    { name: "healthThreshold", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "collateralTokensHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const DEFENDER_REVOKE_TYPES = {
  DefenderRevoke: [
    { name: "wallet", type: "address" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

// Used by /api/defender/status to authenticate the wallet owner so the route
// can return the FULL payload (sessionKey, collateralTokens, installUserOpHash).
// Without this proof the endpoint returns only the public policy summary.
export const DEFENDER_STATUS_AUTH_TYPES = {
  DefenderStatusAuth: [
    { name: "wallet", type: "address" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

export function hashStatusAuthPayload(args: {
  chainId: number;
  verifyingContract: Address;
  wallet: Address;
  expiresAt: bigint;
}): Hex {
  return hashTypedData({
    domain: defenderDomain(args.chainId, args.verifyingContract),
    types: DEFENDER_STATUS_AUTH_TYPES,
    primaryType: "DefenderStatusAuth",
    message: { wallet: args.wallet, expiresAt: args.expiresAt },
  });
}

export function hashRegisterPayload(args: {
  chainId: number;
  verifyingContract: Address;
  wallet: Address;
  sessionKey: Address;
  weeklyLimitUsdg: bigint;
  healthThreshold: bigint;
  expiresAt: bigint;
  collateralTokensHash: Hex;
  nonce: bigint;
}): Hex {
  return hashTypedData({
    domain: defenderDomain(args.chainId, args.verifyingContract),
    types: DEFENDER_REGISTER_TYPES,
    primaryType: "DefenderRegister",
    message: {
      wallet: args.wallet,
      sessionKey: args.sessionKey,
      weeklyLimitUsdg: args.weeklyLimitUsdg,
      healthThreshold: args.healthThreshold,
      expiresAt: args.expiresAt,
      collateralTokensHash: args.collateralTokensHash,
      nonce: args.nonce,
    },
  });
}

export function hashRevokePayload(args: {
  chainId: number;
  verifyingContract: Address;
  wallet: Address;
  expiresAt: bigint;
  nonce: bigint;
}): Hex {
  return hashTypedData({
    domain: defenderDomain(args.chainId, args.verifyingContract),
    types: DEFENDER_REVOKE_TYPES,
    primaryType: "DefenderRevoke",
    message: {
      wallet: args.wallet,
      expiresAt: args.expiresAt,
      nonce: args.nonce,
    },
  });
}

// ─── Fetch with timeout ────────────────────────────────────────────────────

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 5_000, ...rest } = init;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

// ─── Error sanitizer ───────────────────────────────────────────────────────
//
// Map viem / fetch / generic errors to stable codes. Never leak `err.message`
// to the client — it can contain RPC URLs (with API keys), addresses, raw
// calldata, etc.

export function sanitizeError(err: unknown): { code: string; logMessage: string } {
  const logMessage = err instanceof Error ? err.message : String(err);
  const lower = logMessage.toLowerCase();
  if (lower.includes("nonce")) return { code: "nonce_error", logMessage };
  if (lower.includes("insufficient funds")) return { code: "insufficient_funds", logMessage };
  if (lower.includes("user rejected")) return { code: "user_rejected", logMessage };
  if (lower.includes("aborted") || lower.includes("timeout"))
    return { code: "upstream_timeout", logMessage };
  if (lower.includes("invalid signature") || lower.includes("signature"))
    return { code: "invalid_signature", logMessage };
  if (lower.includes("revert")) return { code: "execution_reverted", logMessage };
  if (lower.includes("rate") && lower.includes("limit"))
    return { code: "rate_limited", logMessage };
  if (lower.includes("network") || lower.includes("fetch failed"))
    return { code: "upstream_unavailable", logMessage };
  return { code: "internal_error", logMessage };
}

// ─── Per-IP rate limit (token bucket, Upstash-backed when available) ───────

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

const memBuckets: Map<string, BucketState> = (() => {
  const g = globalThis as unknown as { __equiflowRateMem?: Map<string, BucketState> };
  if (!g.__equiflowRateMem) g.__equiflowRateMem = new Map();
  return g.__equiflowRateMem;
})();

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstashIncr(key: string, ttlSeconds: number): Promise<number | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetchWithTimeout(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["INCR", key]),
      timeoutMs: 1500,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: number };
    const v = typeof json.result === "number" ? json.result : null;
    if (v === 1) {
      // Best-effort TTL set. Ignore failures.
      void fetchWithTimeout(UPSTASH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${UPSTASH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(["EXPIRE", key, ttlSeconds]),
        timeoutMs: 1500,
      }).catch(() => undefined);
    }
    return v;
  } catch {
    return null;
  }
}

export interface RateLimitOpts {
  /// Identifier for the limit bucket family (e.g. "tick", "register").
  bucket: string;
  /// Requests permitted in the rolling window.
  max: number;
  /// Window length in seconds.
  windowSeconds: number;
}

function clientKey(req: Request): string {
  // Prefer x-forwarded-for (Vercel sets this). Fall back to a constant — at
  // worst rate limits become per-process global, still strictly safer than
  // no limit. We do NOT trust the header for any auth purpose.
  //
  // WARNING: bare-Node deploys must strip/overwrite XFF at the reverse proxy
  // (nginx `set_real_ip_from`, Caddy `trusted_proxies`) — otherwise an
  // attacker can spoof their bucket per request.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "anon";
}

export async function requireRateLimit(req: Request, opts: RateLimitOpts): Promise<void> {
  const ip = clientKey(req);
  const upstreamKey = `rl:${opts.bucket}:${opts.windowSeconds}:${ip}`;
  const upstream = await upstashIncr(upstreamKey, opts.windowSeconds);
  if (upstream !== null) {
    if (upstream > opts.max) throw new ApiError(429, "rate_limited");
    return;
  }
  // Upstash unavailable. In production, hard-fail rather than degrade to a
  // per-process bucket — across Vercel lambdas an attacker just rotates
  // instances and pretends the limit doesn't exist.
  if (UPSTASH_URL && process.env.NODE_ENV === "production") {
    throw new ApiError(503, "rate_limit_store_unavailable");
  }
  // Fallback: in-memory token bucket. Dev or unconfigured-Upstash only.
  const now = Date.now();
  const refillPerMs = opts.max / (opts.windowSeconds * 1000);
  const memKey = `${opts.bucket}:${ip}`;
  const state = memBuckets.get(memKey) ?? { tokens: opts.max, lastRefillMs: now };
  const elapsed = Math.max(0, now - state.lastRefillMs);
  state.tokens = Math.min(opts.max, state.tokens + elapsed * refillPerMs);
  state.lastRefillMs = now;
  if (state.tokens < 1) {
    memBuckets.set(memKey, state);
    throw new ApiError(429, "rate_limited");
  }
  state.tokens -= 1;
  memBuckets.set(memKey, state);
}

// ─── Address-allowlist + priceId-allowlist helpers ─────────────────────────

export function requireAllowedAddress(
  candidate: Address,
  allowlist: ReadonlyArray<Address>,
  field = "address",
): void {
  const lc = candidate.toLowerCase();
  for (const a of allowlist) {
    if (a.toLowerCase() === lc) return;
  }
  throw new ApiError(403, `disallowed_${field}`);
}

export function isHex(value: unknown, length: number): value is Hex {
  return (
    typeof value === "string" &&
    value.length === length &&
    /^0x[0-9a-fA-F]+$/.test(value)
  );
}

export function requireAddressValue(value: unknown, field = "address"): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new ApiError(400, `invalid_${field}`);
  }
  return value as Address;
}

// ─── Anti-replay nonce (Upstash SETNX with TTL) ────────────────────────────

const REPLAY_TTL_SECONDS = 15 * 60;

export async function consumeReplayNonce(nonce: Hex, scope: string): Promise<void> {
  if (!isHex(nonce, 66)) throw new ApiError(400, "invalid_nonce");
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    // Upstash not configured. In production this means our anti-replay would
    // be per-process — a multi-instance attacker just rotates lambdas. Block.
    if (process.env.NODE_ENV === "production") {
      throw new ApiError(503, "replay_store_unavailable");
    }
    // Dev only: in-memory fallback. Per-process scope. Best-effort.
    const g = globalThis as unknown as { __equiflowReplay?: Map<string, number> };
    if (!g.__equiflowReplay) g.__equiflowReplay = new Map();
    const key = `${scope}:${nonce}`;
    const now = Date.now();
    // Sweep expired entries occasionally.
    if (g.__equiflowReplay.size > 5000) {
      for (const [k, v] of g.__equiflowReplay) {
        if (now - v > REPLAY_TTL_SECONDS * 1000) g.__equiflowReplay.delete(k);
      }
    }
    if (g.__equiflowReplay.has(key)) throw new ApiError(409, "replay_detected");
    g.__equiflowReplay.set(key, now);
    return;
  }
  try {
    const res = await fetchWithTimeout(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["SET", `replay:${scope}:${nonce}`, "1", "NX", "EX", REPLAY_TTL_SECONDS]),
      timeoutMs: 1500,
    });
    if (!res.ok) throw new ApiError(503, "replay_check_failed");
    const json = (await res.json()) as { result?: string | null };
    if (json.result !== "OK") throw new ApiError(409, "replay_detected");
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(503, "replay_check_failed");
  }
}

export function generateNonce(): Hex {
  return `0x${randomBytes(32).toString("hex")}` as Hex;
}

// ─── Generic Upstash REST helpers ──────────────────────────────────────────
//
// Lightweight wrappers used by keeper-nonce (and future call sites) for atomic
// counters. They share the same fail-modes as the rate-limit helpers above:
// when UPSTASH_* env vars are missing, the helper returns `null` so the caller
// can fall back to in-process state (development convenience). In production
// callers MUST hard-fail when null is returned and UPSTASH_URL is configured.

export const UPSTASH_REST_CONFIGURED = !!(UPSTASH_URL && UPSTASH_TOKEN);

async function upstashCall<T>(cmd: (string | number)[]): Promise<T | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetchWithTimeout(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cmd),
      timeoutMs: 1500,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T; error?: string };
    if (json.error) return null;
    return (json.result ?? null) as T | null;
  } catch {
    return null;
  }
}

/// SET key val NX EX ttl. Returns true when the key was created, false when
/// it already existed, null on transport failure / not-configured.
export async function upstashSetNx(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<boolean | null> {
  const r = await upstashCall<string | null>(["SET", key, value, "NX", "EX", ttlSeconds]);
  if (r === null) return UPSTASH_REST_CONFIGURED ? null : null;
  return r === "OK";
}

/// INCR key → integer. null on transport failure / not-configured.
export async function upstashIncrement(key: string): Promise<number | null> {
  const r = await upstashCall<number | string>(["INCR", key]);
  if (r === null) return null;
  return typeof r === "number" ? r : Number(r);
}

/// DEL key → integer (number of keys removed). null on transport failure.
export async function upstashDel(key: string): Promise<number | null> {
  return upstashCall<number>(["DEL", key]);
}
