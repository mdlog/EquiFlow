import { NextResponse } from "next/server";
import { PYTH_PRICE_IDS } from "@/lib/web3/pyth";

/// Batched 24h change% endpoint.
///
/// Usage: GET /api/markets/24h?syms=TSLA,AMZN,PLTR
///
/// Hybrid source:
///   - `now`  → Hermes /v2/updates/price/latest  (cheap, single batched call)
///   - `then` → Pyth Benchmarks TradingView shim  (per-symbol, designed for
///              historical OHLC; Hermes historical retention is too thin for
///              reliable t-24h lookups, especially on equity feeds).
///
/// Benchmarks returns hourly/minute bars, so `then` is "close of the bar
/// covering t-86400" — close enough for a 24h change number. We tolerate
/// per-symbol failure via Promise.allSettled; missing `then` surfaces as
/// changePct: null and the markets row falls back to STOCKS.changePct.
///
/// Edge cache: 60s.

const HERMES = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";
const BENCHMARKS =
  process.env.PYTH_BENCHMARKS_URL ?? "https://benchmarks.pyth.network";
const DAY = 86400;
const MAX_SYMS = 20;

/// Most equity tickers Pyth carries are exposed via `Equity.US.<TICKER>/USD`.
/// Override here if a future symbol needs a different feed name (ETF/index).
const BENCHMARK_OVERRIDES: Record<string, string> = {
  // Add overrides like:  SPY: "Equity.US.SPY/USD",
};

function benchmarkSymbol(sym: string): string {
  return BENCHMARK_OVERRIDES[sym] ?? `Equity.US.${sym}/USD`;
}

interface ParsedPrice {
  id: string;
  price: { price: string; expo: number; publish_time: number };
}

interface SymOut {
  now: number | null;
  then: number | null;
  changePct: number | null;
  publishTimeNow: number | null;
  publishTimeThen: number | null;
  thenSource: "benchmarks" | null;
}

function parsePythNumber(p: ParsedPrice["price"]): number {
  return Number(BigInt(p.price)) * 10 ** p.expo;
}

async function fetchHermesLatest(idsQS: string): Promise<ParsedPrice[]> {
  const res = await fetch(
    `${HERMES}/v2/updates/price/latest?${idsQS}&parsed=true`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`hermes_${res.status}`);
  const data = (await res.json()) as { parsed?: ParsedPrice[] };
  return data.parsed ?? [];
}

interface BenchmarksBars {
  s: "ok" | "no_data" | "error";
  t?: number[];
  c?: number[];
  errmsg?: string;
}

/// Fetch the close price closest to `target` (unix seconds) from Pyth Benchmarks.
/// Uses 60-minute resolution and a ±90-minute window, then picks the bar whose
/// timestamp is closest to `target`. Returns null when Benchmarks has no data
/// for this symbol/window (common at session boundaries / weekends).
async function fetchBenchmarksClose(
  sym: string,
  target: number,
): Promise<{ price: number; time: number } | null> {
  const symbol = benchmarkSymbol(sym);
  // Wider window — Benchmarks 60-min bars only fall inside regular trading
  // hours, so a ±90min window misses anything that lands in pre/post/overnight.
  // ±12h guarantees we catch at least the previous regular session close.
  const from = target - 43200;
  const to = target + 43200;
  const url =
    `${BENCHMARKS}/v1/shims/tradingview/history` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=60` +
    `&from=${from}` +
    `&to=${to}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.warn(
      `[24h] benchmarks http ${res.status} for ${sym} (${symbol}) url=${url}`,
    );
    return null;
  }
  const data = (await res.json()) as BenchmarksBars;
  if (data.s !== "ok" || !data.t?.length || !data.c?.length) {
    console.warn(
      `[24h] benchmarks no_data for ${sym} (${symbol}) s=${data.s} errmsg=${data.errmsg ?? ""} tlen=${data.t?.length ?? 0}`,
    );
    return null;
  }

  /// Pick the bar whose timestamp is closest to `target` — Benchmarks bars
  /// are bucketed, not point-in-time, so "closest" is a better approximation
  /// than "first after".
  let bestIdx = 0;
  let bestDist = Math.abs(data.t[0] - target);
  for (let i = 1; i < data.t.length; i++) {
    const d = Math.abs(data.t[i] - target);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return { price: data.c[bestIdx], time: data.t[bestIdx] };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symsParam = url.searchParams.get("syms") ?? "";
  const syms = symsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMS);

  if (syms.length === 0) {
    return NextResponse.json({ error: "missing_syms" }, { status: 400 });
  }

  const mapped = syms
    .map((s) => [s, PYTH_PRICE_IDS[s]] as const)
    .filter(([, id]) => !!id) as Array<readonly [string, `0x${string}`]>;

  if (mapped.length === 0) {
    return NextResponse.json({ error: "no_known_feeds" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const then = now - DAY;

  // ── 1. Batched latest from Hermes ────────────────────────────────────────
  const idsQS = mapped.map(([, id]) => `ids[]=${id}`).join("&");
  let latest: ParsedPrice[] = [];
  try {
    latest = await fetchHermesLatest(idsQS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "hermes_latest_failed", detail: msg },
      { status: 502 },
    );
  }

  // ── 2. Per-symbol historical from Benchmarks ─────────────────────────────
  const benchmarksResults = await Promise.allSettled(
    mapped.map(([sym]) => fetchBenchmarksClose(sym, then)),
  );

  // ── 3. Stitch ────────────────────────────────────────────────────────────
  const latestById = new Map<string, ParsedPrice>();
  for (const p of latest) {
    latestById.set(p.id.toLowerCase().replace(/^0x/, ""), p);
  }

  const out: Record<string, SymOut> = {};
  mapped.forEach(([sym, id], i) => {
    const key = id.toLowerCase().replace(/^0x/, "");
    const latestEntry = latestById.get(key);
    const benchRes = benchmarksResults[i];
    const thenBar =
      benchRes.status === "fulfilled" && benchRes.value ? benchRes.value : null;

    const nowPrice = latestEntry ? parsePythNumber(latestEntry.price) : null;
    const thenPrice = thenBar?.price ?? null;
    const changePct =
      nowPrice != null && thenPrice != null && thenPrice > 0
        ? ((nowPrice - thenPrice) / thenPrice) * 100
        : null;

    out[sym] = {
      now: nowPrice,
      then: thenPrice,
      changePct,
      publishTimeNow: latestEntry?.price.publish_time ?? null,
      publishTimeThen: thenBar?.time ?? null,
      thenSource: thenBar ? "benchmarks" : null,
    };
  });

  return NextResponse.json(out, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
