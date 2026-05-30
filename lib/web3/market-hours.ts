// Infer equity market open/closed from Pyth Hermes data freshness — no
// hardcoded NYSE calendar needed. Pyth's first-party publishers stop updating
// equity feeds when the underlying market is closed, so a stale `publish_time`
// means the market is closed. The threshold is set well above the live publish
// cadence (sub-second in regular hours, a few seconds in pre/post sessions) but
// far below the overnight/weekend gap, so brief keeper/Pyth hiccups don't flap
// the on-chain gate.

/// <= this many seconds old => a Pyth session is live => market OPEN.
export const MARKET_OPEN_FRESH_SEC = 300; // 5 min

/// On-chain vault enum: 0 = OPEN, 1 = CLOSED.
export type MarketStatusCode = 0 | 1;

export function inferMarketOpen(
  publishTimeSec: number,
  nowSec: number,
  freshSec: number = MARKET_OPEN_FRESH_SEC,
): boolean {
  return nowSec - publishTimeSec <= freshSec;
}

export function marketStatusCode(
  publishTimeSec: number,
  nowSec: number,
  freshSec: number = MARKET_OPEN_FRESH_SEC,
): MarketStatusCode {
  return inferMarketOpen(publishTimeSec, nowSec, freshSec) ? 0 : 1;
}
