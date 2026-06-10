"use client";

import { formatUnits } from "viem";
import { useProtocolStats, useListedAssets } from "@/lib/hooks/use-protocol-stats";
import { useStockPrices } from "@/lib/hooks/use-adapter-price";
import { useRecentVaultEvents } from "@/lib/hooks/use-recent-vault-events";
import { AutoDefenderStat } from "@/components/AutoDefenderStat";
import { explorerTx } from "@/lib/contracts";
import { fmt } from "@/lib/format";

const KIND_COLOR: Record<string, string> = {
  pledge: "var(--ink)",
  repay: "var(--up)",
  liquidated: "var(--down)",
};

function ageLabel(t: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 90 * 60) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/// Oracle freshness for the telemetry band: seconds since the newest on-chain
/// Pyth push across live symbols. Hermes-fallback prices carry updatedAt 0 and
/// must not count — rendering "—" beats a false multi-year staleness.
function freshnessLabel(
  prices: Record<string, { updatedAt: number }>,
): string | null {
  const newest = Math.max(
    0,
    ...Object.values(prices).map((p) => p.updatedAt),
  );
  if (newest === 0) return null;
  const age = Math.max(0, Math.floor(Date.now() / 1000) - newest);
  if (age < 120) return `${age}s`;
  if (age < 120 * 60) return `${Math.floor(age / 60)}m`;
  return `${Math.floor(age / 3600)}h`;
}

export function StatBand() {
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  const prices = useStockPrices();
  // Real protocol activity (last 24h) — the strongest proof-of-life signal
  // the page has. Single-chunk getLogs: the vault address is sparse enough
  // that the public RPC serves the whole range in one call per event type.
  // Row renders only when there is something to show; an empty "no activity"
  // ledger would read deader than no ledger at all.
  const { events } = useRecentVaultEvents({
    windowBlocks: 345_600n,
    chunkBlocks: 400_000n,
  });

  const tvl =
    stats.tvlUsd != null
      ? fmt.usd(Number(formatUnits(stats.tvlUsd, 18)), 2)
      : "—";
  const borrowed =
    stats.borrowedUsd != null
      ? fmt.usd(Number(formatUnits(stats.borrowedUsd, 18)), 2)
      : "—";
  const utilization =
    stats.utilizationPct != null
      ? fmt.pct(stats.utilizationPct, 1)
      : "—";
  const freshness = freshnessLabel(prices);

  const live = stats.tvlUsd != null;

  const cells = [
    { label: "TVL", value: tvl, sub: "on-chain" },
    { label: "Borrowed", value: borrowed, sub: "total debt" },
    { label: "Utilization", value: utilization, sub: "vault-wide" },
    {
      label: "Oracle freshness",
      value: freshness ?? "—",
      sub: "Pyth · last push",
    },
  ];

  return (
    <section
      className="border-b border-hairline bg-paper-alt py-8 sm:py-11"
    >
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8">
        <div
          className="font-mono text-ink-mute uppercase inline-flex items-center"
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            marginBottom: 22,
            paddingLeft: 24,
          }}
        >
          <span
            className={`rounded-full mr-2 inline-block ${live ? "bg-up" : "bg-ink-mute"}`}
            style={{
              width: 6,
              height: 6,
              animation: live ? "ef-breathe 2.2s ease-in-out infinite" : undefined,
            }}
          />
          Live telemetry · Robinhood Chain testnet
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-y-6">
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

        {events.length > 0 && (
          <div
            className="mt-8 pt-4 flex flex-wrap items-baseline font-mono"
            style={{
              borderTop: "1px solid var(--hairline)",
              fontSize: 11,
              gap: "8px 24px",
              paddingLeft: 24,
              paddingRight: 24,
            }}
          >
            <span
              className="text-ink-mute uppercase"
              style={{ letterSpacing: "0.14em", fontSize: 10 }}
            >
              Recent activity · 24h
            </span>
            {events.slice(0, 3).map((e) => (
              <a
                key={e.txHash}
                href={explorerTx(e.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="no-underline text-ink-soft hover:text-ink inline-flex items-center gap-1.5 animate-fade-in"
              >
                <span
                  className="rounded-full inline-block"
                  style={{
                    width: 5,
                    height: 5,
                    background: KIND_COLOR[e.kind] ?? "var(--ink)",
                  }}
                />
                {e.label}
                <span className="text-ink-mute">· {ageLabel(e.timestamp)}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
