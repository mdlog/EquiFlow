import { NextResponse } from "next/server";
import { PYTH_PRICE_IDS_BY_SESSION, type PythSession } from "@/lib/web3/pyth";
import { ApiError, withErrorHandler } from "@/lib/api/handler";
import {
  fetchWithTimeout,
  requireRateLimit,
  sanitizeError,
} from "@/lib/api/security";

const HERMES = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";
const SYM_RE = /^[A-Z0-9]{1,8}$/;

interface Params {
  params: Promise<{ sym: string }>;
}

interface ParsedFeed {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
}

export const GET = withErrorHandler(async (req: Request, ctx: Params) => {
  await requireRateLimit(req, { bucket: "pyth-by-sym", max: 120, windowSeconds: 60 });
  const { sym } = await ctx.params;
  const upper = sym.toUpperCase();
  if (!SYM_RE.test(upper)) throw new ApiError(400, "invalid_symbol");

  const sessions = PYTH_PRICE_IDS_BY_SESSION[upper];
  if (!sessions) throw new ApiError(404, "unknown_symbol");

  const entries = Object.entries(sessions) as Array<[PythSession, `0x${string}`]>;
  const idsQS = entries.map(([, id]) => `ids[]=${id}`).join("&");
  const url = `${HERMES}/v2/updates/price/latest?${idsQS}&parsed=true`;

  try {
    const res = await fetchWithTimeout(url, { cache: "no-store", timeoutMs: 5_000 });
    if (!res.ok) throw new ApiError(502, "hermes_unavailable");
    const data = (await res.json()) as { parsed: ParsedFeed[] };
    if (!data.parsed?.length) throw new ApiError(502, "no_price_data");

    const idToSession = new Map<string, PythSession>();
    for (const [session, id] of entries) {
      idToSession.set(id.toLowerCase().replace(/^0x/, ""), session);
    }

    let best: { feed: ParsedFeed; session: PythSession } | null = null;
    for (const f of data.parsed) {
      const session = idToSession.get(f.id.toLowerCase());
      if (!session) continue;
      if (!best || f.price.publish_time > best.feed.price.publish_time) {
        best = { feed: f, session };
      }
    }
    if (!best) throw new ApiError(502, "no_matching_session");

    const p = best.feed.price;
    return NextResponse.json(
      {
        symbol: upper,
        activeSession: best.session,
        price: p.price,
        conf: p.conf,
        expo: p.expo,
        publishTime: p.publish_time,
      },
      { headers: { "Cache-Control": "public, max-age=3, s-maxage=3" } },
    );
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const { code, logMessage } = sanitizeError(err);
    console.error("[pyth/by-sym] fetch_failed:", logMessage);
    throw new ApiError(502, code);
  }
});
