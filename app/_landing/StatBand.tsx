"use client";

import { formatUnits } from "viem";
import { useProtocolStats, useListedAssets } from "@/lib/hooks/use-protocol-stats";
import { AutoDefenderStat } from "@/components/AutoDefenderStat";
import { fmt } from "@/lib/format";

export function StatBand() {
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);

  const tvl =
    stats.tvlUsd != null
      ? "$" + fmt.abbr(Number(formatUnits(stats.tvlUsd, 18)))
      : "—";
  const borrowed =
    stats.borrowedUsd != null
      ? "$" + fmt.abbr(Number(formatUnits(stats.borrowedUsd, 18)))
      : "—";
  const utilization =
    stats.utilizationPct != null
      ? fmt.pct(stats.utilizationPct, 1)
      : "—";
  const liqCount =
    stats.liquidations7d != null
      ? stats.liquidations7d.count.toLocaleString("en-US")
      : "—";

  const cells = [
    { label: "TVL", value: tvl, sub: "on-chain", trend: "flat" as const },
    { label: "Borrowed", value: borrowed, sub: "total debt", trend: "flat" as const },
    { label: "Utilization", value: utilization, sub: "vault-wide", trend: "flat" as const },
    { label: "Liquidations (24h)", value: liqCount, sub: "events", trend: "flat" as const },
  ];

  return (
    <section
      className="border-b border-hairline bg-paper-alt py-8 sm:py-11"
    >
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-y-6">
        {cells.map((s, i) => (
          <div
            key={s.label}
            className="relative"
            style={{
              padding: "0 24px",
              borderLeft: i > 0 ? "1px solid var(--hairline)" : "none",
            }}
          >
            <div
              className="font-medium text-ink-mute uppercase"
              style={{
                fontSize: 10,
                letterSpacing: "0.14em",
                marginBottom: 10,
              }}
            >
              {s.label}
            </div>
            <div
              className="font-serif font-medium tabular"
              style={{ fontSize: 36, letterSpacing: "-0.03em", lineHeight: 1 }}
            >
              {s.value}
            </div>
            <div
              className="font-mono text-ink-mute mt-2 inline-flex items-center gap-1.5"
              style={{ fontSize: 11 }}
            >
              <span>{s.sub}</span>
            </div>
          </div>
        ))}
        <AutoDefenderStat index={cells.length} />
      </div>
    </section>
  );
}
