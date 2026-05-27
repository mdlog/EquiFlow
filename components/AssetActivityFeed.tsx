"use client";

import { useBlockNumber } from "wagmi";
import { type Address } from "viem";
import {
  RBN_AVG_BLOCK_TIME_SEC,
  useAssetActivity,
  type ActivityEvent,
} from "@/lib/hooks/use-asset-activity";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { explorerTx, shortAddr } from "@/lib/contracts";
import { fmt } from "@/lib/format";

/// On-chain activity feed for a single asset — shown on /markets/[sym].
/// Renders the last ~30 Pledged + Liquidated events filtered to one token.

interface Props {
  symbol: string;
  token: Address | undefined;
}

export function AssetActivityFeed({ symbol, token }: Props) {
  const { events, isLoading } = useAssetActivity(token);
  /// Head block lets us convert (head - blockN) into wall-time using the RBN
  /// average block time. Acceptable for "X min ago" labels — anyone needing
  /// exact times can click through to the tx.
  const { data: head } = useBlockNumber({
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { refetchInterval: 60_000 },
  });

  return (
    <section className="border-b border-hairline">
      <div className="max-w-[1320px] mx-auto px-8 py-8">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="eyebrow mb-1">On-chain activity</div>
            <div className="text-ink-soft" style={{ fontSize: 13 }}>
              Last 30 events involving {symbol} — pledges + liquidations from
              the last ~24h.
            </div>
          </div>
          <div
            className="font-mono text-ink-mute"
            style={{ fontSize: 11 }}
          >
            {isLoading ? "scanning logs…" : `${events.length} events`}
          </div>
        </div>

        <div className="border border-hairline rounded-[2px] bg-paper overflow-hidden">
          {/* Header */}
          <div
            className="grid gap-3 px-4 py-2 border-b border-hairline text-ink-mute uppercase font-medium"
            style={{
              gridTemplateColumns: "90px 1.4fr 1fr 0.9fr 90px",
              fontSize: 10,
              letterSpacing: "0.12em",
            }}
          >
            <div>Event</div>
            <div>Actor</div>
            <div className="text-right">USD value</div>
            <div className="text-right">When</div>
            <div className="text-right">Tx</div>
          </div>

          {!token ? (
            <Empty>
              {symbol} is not wired to a Robinhood Chain token in this build —
              no on-chain activity to show.
            </Empty>
          ) : isLoading ? (
            <Empty>Scanning the last 24h of pledges & liquidations…</Empty>
          ) : events.length === 0 ? (
            <Empty>
              No on-chain activity for {symbol} in the last 24h. Try{" "}
              <a
                href="/markets"
                className="underline text-ink-soft hover:text-ink"
              >
                pledging
              </a>{" "}
              to seed the feed.
            </Empty>
          ) : (
            events.map((ev) => (
              <ActivityRow
                key={`${ev.txHash}-${ev.kind}`}
                event={ev}
                headBlock={head}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ActivityRow({
  event: ev,
  headBlock,
}: {
  event: ActivityEvent;
  headBlock: bigint | undefined;
}) {
  const usd = Number(ev.amountUsd / 10n ** 12n) / 1e6;
  const ago = headBlock ? blocksAgo(headBlock, ev.blockNumber) : "—";
  const isLiq = ev.kind === "liquidation";
  const eventColor = isLiq ? "var(--down)" : "var(--up)";

  return (
    <div
      className="grid gap-3 px-4 py-3 border-b border-hairline-soft last:border-b-0 items-center"
      style={{
        gridTemplateColumns: "90px 1.4fr 1fr 0.9fr 90px",
      }}
    >
      <div>
        <span
          className="inline-block font-mono uppercase rounded-[2px]"
          style={{
            fontSize: 9,
            letterSpacing: "0.08em",
            padding: "2px 6px",
            background:
              isLiq ? "rgba(187, 71, 71, 0.12)" : "rgba(63, 152, 95, 0.12)",
            color: eventColor,
            fontWeight: 500,
          }}
        >
          {ev.kind}
        </span>
      </div>
      <div
        className="font-mono text-ink"
        style={{ fontSize: 12 }}
        title={ev.liquidator ? `liquidator: ${ev.liquidator}` : undefined}
      >
        {shortAddr(ev.actor)}
        {ev.liquidator && (
          <span className="text-ink-mute" style={{ fontSize: 10 }}>
            {" · by "}
            {shortAddr(ev.liquidator)}
          </span>
        )}
      </div>
      <div
        className="text-right font-mono tabular font-medium"
        style={{ fontSize: 13, color: eventColor }}
      >
        {isLiq ? "−" : "+"}${fmt.abbr(usd)}
      </div>
      <div
        className="text-right font-mono text-ink-mute"
        style={{ fontSize: 11 }}
      >
        {ago}
      </div>
      <div className="text-right">
        <a
          href={explorerTx(ev.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-ink-mute hover:text-ink no-underline"
          style={{ fontSize: 11 }}
        >
          {ev.txHash.slice(0, 6)}…
        </a>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-center text-ink-mute py-8 px-6"
      style={{ fontSize: 12, lineHeight: 1.5 }}
    >
      {children}
    </div>
  );
}

/// Approximate wall-time delta from a block-number difference. Uses the RBN
/// average block time; precision is "good enough" for activity-feed labels.
function blocksAgo(head: bigint, target: bigint): string {
  if (target >= head) return "just now";
  const delta = Number(head - target);
  const seconds = delta * RBN_AVG_BLOCK_TIME_SEC;
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
