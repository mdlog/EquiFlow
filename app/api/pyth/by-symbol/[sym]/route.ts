import { NextResponse } from "next/server";
import { PYTH_PRICE_IDS } from "@/lib/web3/pyth";
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

  // Pyth deprecated the per-session (pre/post/overnight) equity feeds ~2026-06,
  // so every symbol resolves to its single regular-session feed. `activeSession`
  // is kept ("regular") for response-shape compatibility with existing clients.
  const id = PYTH_PRICE_IDS[upper];
  if (!id) throw new ApiError(404, "unknown_symbol");

  const url = `${HERMES}/v2/updates/price/latest?ids[]=${id}&parsed=true`;

  try {
    const res = await fetchWithTimeout(url, { cache: "no-store", timeoutMs: 5_000 });
    if (!res.ok) throw new ApiError(502, "hermes_unavailable");
    const data = (await res.json()) as { parsed: ParsedFeed[] };
    const feed = data.parsed?.[0];
    if (!feed) throw new ApiError(502, "no_price_data");

    const p = feed.price;
    return NextResponse.json(
      {
        symbol: upper,
        activeSession: "regular",
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
