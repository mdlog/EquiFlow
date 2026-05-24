import { NextResponse } from "next/server";
import { HISTORY_ENABLED, readSeries, downsample } from "@/lib/web3/price-history";

/// Batched sparkline endpoint.
///
/// Usage: GET /api/markets/sparkline?syms=TSLA,AMZN&points=24
///
/// Source-of-truth is the Upstash sorted set that /api/keeper/tick appends to
/// on every successful adapter.updatePrice() tx. Each symbol's data covers
/// roughly the last 24h with one point per keeper tick (~every few seconds,
/// trimmed continuously). We downsample to `points` evenly-spaced buckets so
/// payloads stay tiny.
///
/// When Upstash env vars aren't set we return { enabled: false } and the
/// frontend falls back to the seeded synthetic sparkline. Same shape on both
/// branches so the client doesn't branch on success/failure.

const MAX_SYMS = 20;
const DEFAULT_POINTS = 24;
const MAX_POINTS = 96;

export async function GET(req: Request) {
  if (!HISTORY_ENABLED) {
    return NextResponse.json(
      { enabled: false, series: {} },
      {
        // Cache the disabled response — env can't change between requests
        // without a redeploy, so this is safe to memoize cheaply.
        headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
      },
    );
  }

  const url = new URL(req.url);
  const symsParam = url.searchParams.get("syms") ?? "";
  const syms = symsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMS);

  const pointsRaw = Number(url.searchParams.get("points") ?? DEFAULT_POINTS);
  const points = Math.min(MAX_POINTS, Math.max(2, pointsRaw || DEFAULT_POINTS));

  if (syms.length === 0) {
    return NextResponse.json({ error: "missing_syms" }, { status: 400 });
  }

  const series: Record<string, number[]> = {};
  await Promise.all(
    syms.map(async (sym) => {
      const raw = await readSeries(sym);
      series[sym] = downsample(raw, points);
    }),
  );

  return NextResponse.json(
    { enabled: true, series },
    {
      // 15s — short enough that new keeper ticks appear quickly, long enough
      // to dedupe bursts when several tabs render the same table.
      headers: { "Cache-Control": "public, max-age=15, s-maxage=15" },
    },
  );
}
