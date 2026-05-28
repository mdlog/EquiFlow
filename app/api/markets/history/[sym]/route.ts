import { NextResponse } from "next/server";
import { PYTH_PRICE_IDS } from "@/lib/web3/pyth";
import { HISTORY_ENABLED, readSeries, type HistoryPoint } from "@/lib/web3/price-history";
import { ApiError, withErrorHandler } from "@/lib/api/handler";
import {
  fetchWithTimeout,
  requireRateLimit,
  sanitizeError,
} from "@/lib/api/security";

/// Pyth Benchmarks-backed OHLCV history for a single ticker. Used by the
/// asset detail page (`/markets/[sym]`) to render a real price chart.
///
/// Usage:
///   GET /api/markets/history/TSLA?days=7&resolution=60
///
/// Query params:
///   - `days`        positive integer, default 7, max 90
///   - `resolution`  one of: 1, 5, 15, 30, 60, 240, D (TradingView shim values)
///                   default 60 (1-hour bars) which gives ~168 bars over 7d
///
/// Response:
///   { s: "ok", t: number[], o: number[], h: number[], l: number[], c: number[] }
///   or { s: "no_data" } when Benchmarks has nothing for the symbol/window.
///   The TradingView shim shape is preserved end-to-end so the chart component
///   can swap in a real TV widget later without a re-fetch hop.

const BENCHMARKS =
  process.env.PYTH_BENCHMARKS_URL ?? "https://benchmarks.pyth.network";

const BENCHMARK_OVERRIDES: Record<string, string> = {
  // Mirror the table in /api/markets/24h. Keep both in sync — or factor into
  // lib/pyth.ts if it gets more entries than is comfortable to duplicate.
};

const ALLOWED_RESOLUTIONS = new Set(["1", "5", "15", "30", "60", "240", "D"]);
const MAX_DAYS = 90;

interface Params {
  params: Promise<{ sym: string }>;
}

interface BenchmarksBars {
  s: "ok" | "no_data" | "error";
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  errmsg?: string;
}

export const GET = withErrorHandler(async (req: Request, { params }: Params) => {
  await requireRateLimit(req, { bucket: "markets-history", max: 60, windowSeconds: 60 });
  const { sym } = await params;
  const upper = sym.toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(upper)) throw new ApiError(400, "invalid_symbol");
  if (!PYTH_PRICE_IDS[upper]) throw new ApiError(404, "unknown_symbol");

  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days") ?? 7);
  const days = Math.min(MAX_DAYS, Math.max(1, Math.floor(daysRaw) || 7));
  const resolution = url.searchParams.get("resolution") ?? "60";
  if (!ALLOWED_RESOLUTIONS.has(resolution)) {
    throw new ApiError(400, "invalid_resolution");
  }

  // Cap total bars to prevent expensive long-window queries on minute-resolution.
  const bucketSeconds = resolutionToSeconds(resolution);
  if ((days * 86400) / bucketSeconds > 10_000) {
    throw new ApiError(400, "bar_count_exceeds_limit");
  }

  const symbolName =
    BENCHMARK_OVERRIDES[upper] ?? `Equity.US.${upper}/USD`;
  const now = Math.floor(Date.now() / 1000);
  const from = now - days * 86400;

  const target =
    `${BENCHMARKS}/v1/shims/tradingview/history` +
    `?symbol=${encodeURIComponent(symbolName)}` +
    `&resolution=${resolution}` +
    `&from=${from}` +
    `&to=${now}`;

  try {
    const res = await fetchWithTimeout(target, { cache: "no-store", timeoutMs: 8_000 });
    if (!res.ok) {
      // Log the upstream status server-side, but expose only a stable code
      // to the client so we don't reflect Benchmarks' rate-limit / 5xx text.
      console.warn(`[history] benchmarks http ${res.status} sym=${upper}`);
      return NextResponse.json(
        { s: "error", errmsg: "upstream_unavailable" },
        { status: 502 },
      );
    }
    const data = (await res.json()) as BenchmarksBars;
    const hasBenchmarks = data.s === "ok" && !!data.t?.length;

    const t = hasBenchmarks ? data.t! : [];
    const o = hasBenchmarks ? (data.o ?? []) : [];
    const h = hasBenchmarks ? (data.h ?? []) : [];
    const l = hasBenchmarks ? (data.l ?? []) : [];
    const c = hasBenchmarks ? (data.c ?? []) : [];

    if (HISTORY_ENABLED) {
      const bucketSize = resolutionToSeconds(resolution);
      const keeperFrom = t.length > 0
        ? t[t.length - 1] + 1
        : from;
      const nowTs = Math.floor(Date.now() / 1000);
      const gapSeconds = nowTs - (t.length > 0 ? t[t.length - 1] : from);
      if (gapSeconds > bucketSize) {
        // Upstash gap-fill is best-effort. A transient store failure must NOT
        // mask the Benchmarks bars we already have — degrade gracefully.
        let ticks: HistoryPoint[] = [];
        try {
          ticks = await readSeries(upper, keeperFrom);
        } catch (err) {
          console.warn(`[history] readSeries failed sym=${upper}:`, err);
        }
        if (ticks.length > 0) {
          const bars = ticksToOhlcv(ticks, bucketSize);
          for (const bar of bars) {
            t.push(bar.t);
            o.push(bar.o);
            h.push(bar.h);
            l.push(bar.l);
            c.push(bar.c);
          }
        }
      }
    }

    if (t.length === 0) {
      return NextResponse.json(
        { s: "no_data", errmsg: data.errmsg ?? "" },
        { headers: { "Cache-Control": "public, max-age=120, s-maxage=120" } },
      );
    }

    return NextResponse.json(
      { s: "ok", symbol: upper, resolution, t, o, h, l, c },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=60",
        },
      },
    );
  } catch (err) {
    const { code, logMessage } = sanitizeError(err);
    console.error(`[history] fetch failed sym=${upper}:`, logMessage);
    return NextResponse.json({ s: "error", errmsg: code }, { status: 502 });
  }
});

function resolutionToSeconds(res: string): number {
  if (res === "D") return 86400;
  const mins = Number(res);
  return (mins || 60) * 60;
}

interface OhlcvBar { t: number; o: number; h: number; l: number; c: number }

function ticksToOhlcv(ticks: HistoryPoint[], bucketSec: number): OhlcvBar[] {
  if (ticks.length === 0) return [];
  const sorted = [...ticks].sort((a, b) => a.t - b.t);
  const bars: OhlcvBar[] = [];
  let bucketStart = Math.floor(sorted[0].t / bucketSec) * bucketSec;
  let o = sorted[0].p;
  let h = sorted[0].p;
  let l = sorted[0].p;
  let c = sorted[0].p;

  for (const tick of sorted) {
    const thisBucket = Math.floor(tick.t / bucketSec) * bucketSec;
    if (thisBucket !== bucketStart) {
      bars.push({ t: bucketStart, o, h, l, c });
      bucketStart = thisBucket;
      o = tick.p;
      h = tick.p;
      l = tick.p;
      c = tick.p;
    } else {
      h = Math.max(h, tick.p);
      l = Math.min(l, tick.p);
      c = tick.p;
    }
  }
  bars.push({ t: bucketStart, o, h, l, c });
  return bars;
}
