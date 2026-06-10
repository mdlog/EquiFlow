"use client";

import { useListedAssets, useProtocolStats } from "@/lib/hooks/use-protocol-stats";

/// The page's sharpest number: what the target user pays today on broker
/// margin vs EquiFlow's live on-chain rate. Broker figures are the published
/// Robinhood Gold / IBKR margin range (docs/PITCH_DECK.md); the EquiFlow side
/// is read live from the vault so the comparison can never drift from chain.
export function RateComparison() {
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  const liveApr = stats.derived
    ? `${(stats.derived.borrowAprBps / 100).toFixed(2)}%`
    : "—";

  return (
    <section className="border-b border-hairline py-8 sm:py-10">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8">
        <div className="grid items-center gap-6 sm:gap-0 grid-cols-1 sm:[grid-template-columns:1fr_auto_1fr]">
          <div className="flex flex-col gap-2">
            <span
              className="text-ink-mute uppercase"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              Broker margin · Robinhood Gold
            </span>
            <span
              className="font-serif font-medium"
              style={{ fontSize: 32, letterSpacing: "-0.03em", lineHeight: 1 }}
            >
              11–13% APR
            </span>
            <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>
              custodial · US-only · opaque margin calls
            </span>
          </div>

          <span
            className="font-serif text-ink-mute text-center"
            style={{ fontSize: 20, padding: "0 36px" }}
          >
            <em>vs</em>
          </span>

          <div className="flex flex-col gap-2 sm:text-right">
            <span
              className="text-ink-mute uppercase"
              style={{ fontSize: 10, letterSpacing: "0.14em" }}
            >
              EquiFlow · Robinhood Chain
            </span>
            <span
              className="font-serif font-medium tabular"
              style={{ fontSize: 32, letterSpacing: "-0.03em", lineHeight: 1 }}
            >
              {liveApr} APR
            </span>
            <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>
              non-custodial · on-chain · live rate
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
