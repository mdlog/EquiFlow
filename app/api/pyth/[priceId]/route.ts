import { NextResponse } from "next/server";

/// Server-side proxy to Pyth Network Hermes.
///
/// Hermes is fully public — no API key, no HMAC signing, no gating. We proxy
/// only to:
///   1. Strip browser CORS issues (Hermes does allow CORS but proxying keeps
///      the keeper logic identical to the Chainlink Streams shape).
///   2. Add a short edge cache so multiple browser tabs share fetches.
///
/// The keeper calls /api/pyth/[priceId], gets parsed price values, then
/// re-encodes into a MockPyth-compatible PriceFeed payload before pushing
/// on-chain. On a chain with real Pyth deployment we'd forward `binary.data`
/// directly to `updatePriceFeeds` instead.

const HERMES = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";

interface Params {
  params: Promise<{ priceId: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { priceId } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(priceId)) {
    return NextResponse.json({ error: "invalid priceId" }, { status: 400 });
  }

  const url = `${HERMES}/v2/updates/price/latest?ids[]=${priceId}&encoding=hex&parsed=true`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: "hermes_error", status: res.status },
        { status: 502 },
      );
    }
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
    if (!parsed) {
      return NextResponse.json({ error: "no_price_data" }, { status: 502 });
    }

    return NextResponse.json(
      {
        priceId: "0x" + parsed.id,
        // Raw Pyth values — keeper re-encodes for MockPyth on RBN.
        price: parsed.price.price, // int64 as string
        conf: parsed.price.conf, // uint64 as string
        expo: parsed.price.expo, // int32
        publishTime: parsed.price.publish_time, // unix seconds
        // For chains with real Pyth deployment: pass `binary.data[0]` directly
        // to updatePriceFeeds. Currently RBN uses MockPyth and ignores this.
        binaryUpdate: "0x" + data.binary.data[0],
      },
      {
        headers: {
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
