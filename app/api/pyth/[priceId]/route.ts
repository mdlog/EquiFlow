import { NextResponse } from "next/server";
import { ApiError, withErrorHandler } from "@/lib/api/handler";
import {
  fetchWithTimeout,
  requireRateLimit,
  sanitizeError,
} from "@/lib/api/security";

// Server-side proxy to Pyth Network Hermes. Hardened with timeout + rate limit.

const HERMES = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";
const PRICE_ID_RE = /^0x[0-9a-fA-F]{64}$/;

interface Params {
  params: Promise<{ priceId: string }>;
}

export const GET = withErrorHandler(async (req: Request, ctx: Params) => {
  await requireRateLimit(req, { bucket: "pyth-by-id", max: 120, windowSeconds: 60 });
  const { priceId } = await ctx.params;
  if (!PRICE_ID_RE.test(priceId)) throw new ApiError(400, "invalid_price_id");

  const url = `${HERMES}/v2/updates/price/latest?ids[]=${priceId}&encoding=hex&parsed=true`;
  try {
    const res = await fetchWithTimeout(url, { cache: "no-store", timeoutMs: 5_000 });
    if (!res.ok) throw new ApiError(502, "hermes_unavailable");
    const data = (await res.json()) as {
      binary: { encoding: string; data: string[] };
      parsed: Array<{
        id: string;
        price: { price: string; conf: string; expo: number; publish_time: number };
        ema_price: { price: string; conf: string; expo: number; publish_time: number };
        metadata: unknown;
      }>;
    };
    const parsed = data.parsed?.[0];
    if (!parsed) throw new ApiError(502, "no_price_data");

    return NextResponse.json(
      {
        priceId: "0x" + parsed.id,
        price: parsed.price.price,
        conf: parsed.price.conf,
        expo: parsed.price.expo,
        publishTime: parsed.price.publish_time,
        binaryUpdate: "0x" + data.binary.data[0],
      },
      { headers: { "Cache-Control": "public, max-age=3, s-maxage=3" } },
    );
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const { code, logMessage } = sanitizeError(err);
    console.error("[pyth/by-id] fetch_failed:", logMessage);
    throw new ApiError(502, code);
  }
});
