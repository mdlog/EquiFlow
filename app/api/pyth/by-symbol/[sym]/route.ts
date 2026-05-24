import { NextResponse } from "next/server";
import { PYTH_PRICE_IDS_BY_SESSION, type PythSession } from "@/lib/web3/pyth";

/// Server-side proxy that returns the FRESHEST Pyth session for a US equity
/// ticker. US equities publish on 4 separate Pyth feeds (regular, pre, post,
/// overnight) that together cover 24/5. This route queries all 4 in one Hermes
/// call and picks the one with the most recent `publish_time`.
///
/// The keeper passes the returned price values to /api/keeper/tick, which
/// encodes them into a MockPyth payload tagged with the adapter's registered
/// priceId (always the regular-session id). MockPyth caches verbatim — no
/// signature check — so the substitution is transparent on RBN.

const HERMES = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";

interface Params {
  params: Promise<{ sym: string }>;
}

interface ParsedFeed {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
}

export async function GET(_req: Request, { params }: Params) {
  const { sym } = await params;
  const upper = sym.toUpperCase();
  const sessions = PYTH_PRICE_IDS_BY_SESSION[upper];
  if (!sessions) {
    return NextResponse.json(
      { error: "unknown_symbol", symbol: upper },
      { status: 404 },
    );
  }

  const entries = Object.entries(sessions) as Array<[PythSession, `0x${string}`]>;
  const idsQS = entries
    .map(([, id]) => `ids[]=${id}`)
    .join("&");
  const url = `${HERMES}/v2/updates/price/latest?${idsQS}&parsed=true`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: "hermes_error", status: res.status },
        { status: 502 },
      );
    }
    const data = (await res.json()) as { parsed: ParsedFeed[] };
    if (!data.parsed || data.parsed.length === 0) {
      return NextResponse.json({ error: "no_price_data" }, { status: 502 });
    }

    // Build a lookup so we can attach the session label to each feed.
    const idToSession = new Map<string, PythSession>();
    for (const [session, id] of entries) {
      idToSession.set(id.toLowerCase().replace(/^0x/, ""), session);
    }

    let best: { feed: ParsedFeed; session: PythSession } | null = null;
    for (const f of data.parsed) {
      const session = idToSession.get(f.id.toLowerCase());
      if (!session) continue;
      if (!best || f.price.publish_time > best.feed.price.publish_time) {
        best = { feed: f, session };
      }
    }
    if (!best) {
      return NextResponse.json({ error: "no_matching_session" }, { status: 502 });
    }

    const p = best.feed.price;
    return NextResponse.json(
      {
        symbol: upper,
        activeSession: best.session,
        // Raw Pyth values from the active session — keeper encodes these
        // into a MockPyth payload tagged with the adapter's registered priceId.
        price: p.price,
        conf: p.conf,
        expo: p.expo,
        publishTime: p.publish_time,
      },
      {
        headers: {
          // Short edge cache — multiple tabs share a fetch within a 3s window.
          "Cache-Control": "public, max-age=3, s-maxage=3",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "fetch_failed", detail: msg },
      { status: 502 },
    );
  }
}
