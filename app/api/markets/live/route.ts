import { NextResponse } from "next/server";
import { PYTH_PRICE_IDS, PYTH_XSTOCK_IDS } from "@/lib/web3/pyth";
import { ApiError, withErrorHandler } from "@/lib/api/handler";
import {
  fetchWithTimeout,
  requireRateLimit,
  sanitizeError,
} from "@/lib/api/security";

/// Batched LIVE price endpoint for the markets UI.
///
/// Usage: GET /api/markets/live?syms=TSLA,AMZN,PLTR
///
/// For each symbol it queries BOTH the regular equity feed and (when available)
/// the 24/7 xStock feed in a SINGLE Hermes call, then returns the FRESHEST of
/// the two by publish_time. This keeps the xStock-covered tickers live around
/// the clock, while the rest stay live during regular hours and return their
/// last close off-hours (clients label them "closed" via the publishTime age).
///
/// Display-only: on-chain adapters and the keeper are unaffected. Short edge
/// cache (3s) so the markets table can poll at a real-time-ish cadence.

const HERMES = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";
const MAX_SYMS = 20;

interface ParsedFeed {
  id: string;
  price: { price: string; expo: number; publish_time: number };
}

type Source = "xstock" | "equity";

interface SymOut {
  price: number | null;
  publishTime: number | null;
  source: Source | null;
}

function parsePythNumber(p: ParsedFeed["price"]): number {
  return Number(BigInt(p.price)) * 10 ** p.expo;
}

function normId(id: string): string {
  return id.toLowerCase().replace(/^0x/, "");
}

export const GET = withErrorHandler(async (req: Request) => {
  await requireRateLimit(req, { bucket: "markets-live", max: 120, windowSeconds: 60 });

  const url = new URL(req.url);
  const syms = Array.from(
    new Set(
      (url.searchParams.get("syms") ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9]{1,8}$/.test(s)),
    ),
  ).slice(0, MAX_SYMS);

  if (syms.length === 0) throw new ApiError(400, "missing_syms");

  // Map every candidate feed id → (symbol, source). Each symbol contributes its
  // equity feed and, when present, its 24/7 xStock feed.
  const idToMeta = new Map<string, { sym: string; source: Source }>();
  for (const sym of syms) {
    const eq = PYTH_PRICE_IDS[sym];
    if (eq) idToMeta.set(normId(eq), { sym, source: "equity" });
    const xs = PYTH_XSTOCK_IDS[sym];
    if (xs) idToMeta.set(normId(xs), { sym, source: "xstock" });
  }
  if (idToMeta.size === 0) throw new ApiError(400, "no_known_feeds");

  const idsQS = Array.from(idToMeta.keys())
    .map((id) => `ids[]=0x${id}`)
    .join("&");

  let parsed: ParsedFeed[] = [];
  try {
    const res = await fetchWithTimeout(
      `${HERMES}/v2/updates/price/latest?${idsQS}&parsed=true`,
      { cache: "no-store", timeoutMs: 5_000 },
    );
    if (!res.ok) throw new ApiError(502, "hermes_unavailable");
    const data = (await res.json()) as { parsed?: ParsedFeed[] };
    parsed = data.parsed ?? [];
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const { code, logMessage } = sanitizeError(err);
    console.error("[markets/live] hermes_failed:", logMessage);
    throw new ApiError(502, code);
  }

  const out: Record<string, SymOut> = {};
  for (const sym of syms) out[sym] = { price: null, publishTime: null, source: null };

  for (const f of parsed) {
    const meta = idToMeta.get(normId(f.id));
    if (!meta) continue;
    const cur = out[meta.sym];
    // Freshest feed per symbol wins (xStock vs equity).
    if (cur.publishTime == null || f.price.publish_time > cur.publishTime) {
      out[meta.sym] = {
        price: parsePythNumber(f.price),
        publishTime: f.price.publish_time,
        source: meta.source,
      };
    }
  }

  return NextResponse.json(out, {
    headers: { "Cache-Control": "public, max-age=3, s-maxage=3" },
  });
});
