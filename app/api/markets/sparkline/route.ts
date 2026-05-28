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

  const series: Record<string, number[]> = {};
  await Promise.all(
    symsDedup.map(async (sym) => {
      const raw = await readSeries(sym);
      series[sym] = downsample(raw, points);
    }),
  );

  return NextResponse.json(
    { enabled: true, series },
    { headers: { "Cache-Control": "public, max-age=15, s-maxage=15" } },
  );
});
