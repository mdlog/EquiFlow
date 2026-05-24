import { NextResponse } from "next/server";
import { PYTH_PRICE_IDS } from "@/lib/web3/pyth";

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

export async function GET(req: Request, { params }: Params) {
  const { sym } = await params;
  const upper = sym.toUpperCase();
  if (!PYTH_PRICE_IDS[upper]) {
    return NextResponse.json(
      { error: "unknown_symbol", symbol: upper },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days") ?? 7);
  const days = Math.min(MAX_DAYS, Math.max(1, Math.floor(daysRaw) || 7));
  const resolution = url.searchParams.get("resolution") ?? "60";
  if (!ALLOWED_RESOLUTIONS.has(resolution)) {
    return NextResponse.json(
      { error: "invalid_resolution" },
      { status: 400 },
    );
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
    const res = await fetch(target, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { s: "error", errmsg: `benchmarks_http_${res.status}` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as BenchmarksBars;
    if (data.s !== "ok" || !data.t?.length) {
      return NextResponse.json(
        { s: data.s ?? "no_data", errmsg: data.errmsg ?? "" },
        // Tell the browser to remember the empty result briefly so reloads
        // don't hammer Benchmarks for symbols that are truly unsupported.
        { headers: { "Cache-Control": "public, max-age=120, s-maxage=120" } },
      );
    }

    // Trim to the OHLC fields the chart needs — drop volume (TV shim returns
    // it as `v` but it's null for most equity feeds and noisy on the wire).
    return NextResponse.json(
      {
        s: "ok",
        symbol: upper,
        resolution,
        t: data.t,
        o: data.o ?? [],
        h: data.h ?? [],
        l: data.l ?? [],
        c: data.c ?? [],
      },
      {
        headers: {
          // 60s = enough granularity for chart freshness without thrashing
          // Benchmarks on every tab focus.
          "Cache-Control": "public, max-age=60, s-maxage=60",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { s: "error", errmsg: msg.slice(0, 240) },
      { status: 502 },
    );
  }
}
