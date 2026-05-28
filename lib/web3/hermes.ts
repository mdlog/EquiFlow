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
