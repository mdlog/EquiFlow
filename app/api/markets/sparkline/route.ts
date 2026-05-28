import { NextResponse } from "next/server";
import { HISTORY_ENABLED, readSeries, downsample } from "@/lib/web3/price-history";
import { ApiError, withErrorHandler } from "@/lib/api/handler";
import { requireRateLimit } from "@/lib/api/security";

// Batched sparkline endpoint, rate-limited per IP. Symbols deduplicated.

const MAX_SYMS = 20;
const DEFAULT_POINTS = 24;
const MAX_POINTS = 96;
const SYM_RE = /^[A-Z0-9]{1,8}$/;

export const GET = withErrorHandler(async (req: Request) => {
  await requireRateLimit(req, { bucket: "sparkline", max: 60, windowSeconds: 60 });

  if (!HISTORY_ENABLED) {
    return NextResponse.json(
      { enabled: false, series: {} },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
    );
  }

  const url = new URL(req.url);
  const symsParam = url.searchParams.get("syms") ?? "";
  const symsDedup = Array.from(
    new Set(
      symsParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => SYM_RE.test(s)),
    ),
  ).slice(0, MAX_SYMS);

  const pointsRaw = Number(url.searchParams.get("points") ?? DEFAULT_POINTS);
  const points = Math.min(MAX_POINTS, Math.max(2, pointsRaw || DEFAULT_POINTS));

  if (symsDedup.length === 0) throw new ApiError(400, "missing_syms");

  // Use allSettled so one symbol's Upstash hiccup doesn't 500 the whole batch.
  // Failures land as an empty array — clients can detect the difference via
  // the `failed` list and decide whether to retry or fall back to seeded data.
  const series: Record<string, number[]> = {};
  const failed: string[] = [];
  const settled = await Promise.allSettled(
    symsDedup.map(async (sym) => ({ sym, raw: await readSeries(sym) })),
  );
  for (const r of settled) {
    if (r.status === "fulfilled") {
      series[r.value.sym] = downsample(r.value.raw, points);
    } else {
      console.warn("[sparkline] readSeries failed:", r.reason);
    }
  }
  for (const sym of symsDedup) {
    if (!(sym in series)) {
      series[sym] = [];
      failed.push(sym);
    }
  }

  return NextResponse.json(
    { enabled: true, series, failed },
    { headers: { "Cache-Control": "public, max-age=15, s-maxage=15" } },
  );
});
