import {
  PYTH_PRICE_IDS,
  PYTH_PRICE_IDS_BY_SESSION,
  type PythSession,
} from "@/lib/web3/pyth";
import { fetchWithTimeout } from "@/lib/api/security";
import type { Hex } from "viem";

// Server-side Hermes (Pyth Network) client. Returns the freshest available
// session quote for a symbol. Used by /api/keeper/tick and /api/keeper/cron
// so the client cannot supply attacker-chosen prices.

const HERMES = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";
const HERMES_TIMEOUT_MS = 5_000;

interface ParsedFeed {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
}

export interface PythQuote {
  price: bigint;
  expo: number;
  publishTime: number;
  session: PythSession;
  conf: bigint;
}

/// Maximum age (in seconds) a Hermes-reported `publish_time` may have before
/// the keeper refuses to push it on-chain. Tuned around Pyth equity cadence:
///   - regular hours: publishes every ~300 ms
///   - extended/overnight: every few seconds
///   - real outages: minutes to hours
/// 60 s rejects only genuine staleness, not normal jitter.
const MAX_PUBLISH_AGE_SECONDS = 60;

/// Maximum confidence interval (basis points of price) the keeper will accept.
/// Pyth `conf` is in the same units as `price`. A 500 bps (5 %) cap rejects
/// feed-source disagreements that imply the aggregate is unreliable.
const MAX_CONF_BPS = 500n;

export type QuoteRejectionReason =
  | "negative_price"
  | "stale_publish_time"
  | "low_confidence";

export interface QuoteValidationResult {
  ok: boolean;
  reason?: QuoteRejectionReason;
  /// Age in seconds at the time of validation (informational; -1 when unset).
  ageSeconds: number;
  /// confidence-to-price ratio in basis points (informational).
  confBps: number;
}

/// Reject a Pyth quote when it is stale or wide. Caller decides what to do
/// with the rejection — the keeper routes throw 503, while UI surfaces can
/// flag visually. Pure: no I/O.
export function validatePythQuote(
  quote: PythQuote,
  nowSec: number = Math.floor(Date.now() / 1000),
  opts: { allowStale?: boolean } = {},
): QuoteValidationResult {
  const age = nowSec - quote.publishTime;
  const confBps =
    quote.price > 0n ? Number((quote.conf * 10_000n) / quote.price) : Number.MAX_SAFE_INTEGER;
  if (quote.price <= 0n) {
    return { ok: false, reason: "negative_price", ageSeconds: age, confBps };
  }
  // `allowStale` is the market-CLOSED path: we intentionally push the last
  // close (stale Hermes data) with a fresh on-chain stamp to hold valuation
  // through the closed session. During OPEN hours stale data is still rejected.
  if (!opts.allowStale && age > MAX_PUBLISH_AGE_SECONDS) {
    return { ok: false, reason: "stale_publish_time", ageSeconds: age, confBps };
  }
  if (BigInt(confBps) > MAX_CONF_BPS) {
    return { ok: false, reason: "low_confidence", ageSeconds: age, confBps };
  }
  return { ok: true, ageSeconds: age, confBps };
}

export async function fetchFreshestPyth(symbol: string): Promise<PythQuote | null> {
  const upper = symbol.toUpperCase();
  const sessions = PYTH_PRICE_IDS_BY_SESSION[upper];

  if (!sessions) {
    const legacyId = PYTH_PRICE_IDS[upper];
    if (!legacyId) return null;
    try {
      const res = await fetchWithTimeout(
        `${HERMES}/v2/updates/price/latest?ids[]=${legacyId}&parsed=true`,
        { cache: "no-store", timeoutMs: HERMES_TIMEOUT_MS },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { parsed: ParsedFeed[] };
      const f = data.parsed?.[0];
      if (!f) return null;
      return {
        price: BigInt(f.price.price),
        expo: f.price.expo,
        publishTime: f.price.publish_time,
        conf: BigInt(f.price.conf),
        session: "regular",
      };
    } catch {
      return null;
    }
  }

  const entries = Object.entries(sessions) as Array<[PythSession, Hex]>;
  const idsQS = entries.map(([, id]) => `ids[]=${id}`).join("&");
  try {
    const res = await fetchWithTimeout(
      `${HERMES}/v2/updates/price/latest?${idsQS}&parsed=true`,
      { cache: "no-store", timeoutMs: HERMES_TIMEOUT_MS },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { parsed: ParsedFeed[] };
    if (!data.parsed?.length) return null;

    const idToSession = new Map<string, PythSession>();
    for (const [session, id] of entries) {
      idToSession.set(id.toLowerCase().replace(/^0x/, ""), session);
    }
    let best: { feed: ParsedFeed; session: PythSession } | null = null;
    for (const f of data.parsed) {
      const session = idToSession.get(f.id.toLowerCase().replace(/^0x/, ""));
      if (!session) continue;
      if (!best || f.price.publish_time > best.feed.price.publish_time) {
        best = { feed: f, session };
      }
    }
    if (!best) return null;
    return {
      price: BigInt(best.feed.price.price),
      expo: best.feed.price.expo,
      publishTime: best.feed.price.publish_time,
      conf: BigInt(best.feed.price.conf),
      session: best.session,
    };
  } catch {
    return null;
  }
}
