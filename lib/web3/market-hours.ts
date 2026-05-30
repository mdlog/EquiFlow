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

// --- On-chain `marketStatus` interpretation (client-side UI gating) --------
// Mirrors the vault's `marketStatus[token]` enum so the UI can disable
// borrowing (and explain why) instead of letting the wallet fail to estimate
// gas on a tx that reverts with `MarketClosed`. The vault gates borrow +
// liquidation when status != 0; pure collateral deposits are NOT gated.

/// Vault enum values for `marketStatus[token]`.
export const MARKET_STATUS = { OPEN: 0, CLOSED: 1, HALTED: 2 } as const;

/// True when trading is gated on-chain (CLOSED or HALTED). `undefined`/`null`
/// is the client's still-loading state and must read as "not closed" so the UI
/// never blocks before the on-chain read resolves.
export function isMarketTradingClosed(status: number | undefined | null): boolean {
  return status != null && status !== MARKET_STATUS.OPEN;
}

/// Human label for a status code; `undefined` (loading) shows the optimistic
/// "Market open" until the read resolves.
export function marketStatusLabel(status: number | undefined | null): string {
  if (status === MARKET_STATUS.HALTED) return "Trading halted";
  if (isMarketTradingClosed(status)) return "Market closed";
  return "Market open";
}

/// Whether a pledge/borrow action is blocked by the market-hours gate. Only
/// blocks when the market is closed AND the user is actually drawing a loan —
/// a deposit-only pledge (`borrowUsd == 0`) stays allowed.
export function isBorrowBlockedByMarket(
  status: number | undefined | null,
  borrowUsd: number,
): boolean {
  return isMarketTradingClosed(status) && borrowUsd > 0;
}
