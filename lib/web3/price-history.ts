/// Server-only price history backed by Upstash Redis (REST).
///
/// One sorted set per ticker: `px:<SYM>` with score = unix-seconds and
/// member = JSON-encoded `{p: number, t: number}`. The keeper appends a point
/// each successful adapter.updatePrice() call, and read endpoints range over
/// the last 24h to build sparkline data + a "then" anchor for changePct.
///
/// We talk to Upstash via plain HTTP + Bearer (the same protocol the official
/// SDK uses) so we avoid adding a node_modules dependency. If the two env
/// vars are missing the module degrades to a silent no-op — the frontend
/// then falls back to the static STOCKS.changePct + seeded sparkline.

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const HISTORY_ENABLED = !!(URL && TOKEN);

const DAY = 86400;
/// Keep a small safety margin past 24h so a late reader can still bracket the
/// t-24h anchor when the keeper has only just trimmed older entries.
const TRIM_AFTER = DAY + 600;

type Cmd = (string | number)[];

async function pipeline(cmds: Cmd[]): Promise<unknown[]> {
  if (!HISTORY_ENABLED) return [];
  const res = await fetch(`${URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmds),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`upstash_pipeline_${res.status}`);
  }
  const json = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  return json.map((r) => {
    if (r.error) throw new Error(`upstash_cmd_${r.error}`);
    return r.result;
  });
}

/// Append a price observation and trim anything older than ~24h in one round-trip.
/// Silently no-ops when Redis is not configured. Errors are swallowed so the
/// keeper success path is never blocked by a history-store failure.
export async function recordPrice(
  symbol: string,
  price: number,
  tsSeconds: number,
): Promise<void> {
  if (!HISTORY_ENABLED) return;
  const key = `px:${symbol.toUpperCase()}`;
  const member = JSON.stringify({ p: price, t: tsSeconds });
  try {
    await pipeline([
      ["ZADD", key, tsSeconds, member],
      ["ZREMRANGEBYSCORE", key, 0, tsSeconds - TRIM_AFTER],
      ["EXPIRE", key, TRIM_AFTER],
    ]);
  } catch {
    // History writes are best-effort — never break the keeper tx response.
  }
}

export interface HistoryPoint {
  t: number; // unix seconds
  p: number; // USD price
}

/// Read raw points for a symbol from `fromTs` to now (default: last 24h).
/// Returns [] when Redis is not configured or the set is empty.
export async function readSeries(
  symbol: string,
  fromTs?: number,
): Promise<HistoryPoint[]> {
  if (!HISTORY_ENABLED) return [];
  const key = `px:${symbol.toUpperCase()}`;
  const now = Math.floor(Date.now() / 1000);
  const min = fromTs ?? now - DAY;
  let raw: unknown;
  try {
    const out = await pipeline([
      ["ZRANGEBYSCORE", key, min, now],
    ]);
    raw = out[0];
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const points: HistoryPoint[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    try {
      const obj = JSON.parse(v) as { p?: unknown; t?: unknown };
      if (typeof obj.p === "number" && typeof obj.t === "number") {
        points.push({ p: obj.p, t: obj.t });
      }
    } catch {
      // skip malformed entry
    }
  }
  return points;
}

/// Downsample a series to roughly N evenly-spaced points by bucketing time.
/// Used to produce sparkline-friendly arrays without sending hundreds of raw
/// keeper ticks down to the browser.
export function downsample(points: HistoryPoint[], n: number): number[] {
  if (points.length === 0 || n <= 0) return [];
  if (points.length <= n) return points.map((p) => p.p);
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const first = sorted[0].t;
  const last = sorted[sorted.length - 1].t;
  const span = Math.max(1, last - first);
  const out: number[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const bucketEnd = first + Math.floor(((i + 1) * span) / n);
    let sum = 0;
    let count = 0;
    while (cursor < sorted.length && sorted[cursor].t <= bucketEnd) {
      sum += sorted[cursor].p;
      count++;
      cursor++;
    }
    if (count > 0) {
      out.push(sum / count);
    } else if (out.length > 0) {
      // Carry-forward when a bucket has no samples — keeps the curve continuous.
      out.push(out[out.length - 1]);
    }
  }
  return out;
}
