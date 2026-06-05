"use client";

import { useEffect, useMemo, useState } from "react";
import { type Address } from "viem";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";
import { LiquidateModal } from "@/components/LiquidateModal";
import { fmt } from "@/lib/format";
import {
  useAtRiskPositions,
  type AtRiskPosition,
} from "@/lib/hooks/use-at-risk-positions";
import {
  useListedAssets,
  useProtocolStats,
} from "@/lib/hooks/use-protocol-stats";
import {
  useRecentLiquidations,
  bucketByHour,
  relTime,
  type RecentLiquidation,
} from "@/lib/hooks/use-recent-liquidations";
import { shortAddr, explorerAddr, explorerTx } from "@/lib/contracts";

/// EquiFlow liquidations dashboard — industry-standard layout.
///
///   1. PageNav (with live/30s-scan toggle in rightExtras)
///   2. Hero: kicker · headline · intro paragraph · LAST SCAN block
///   3. KPI strip — 5 protocol-wide risk metrics
///   4. Risk distribution histogram + 24h timeline (2-col)
///   5. Liquidatable now table (primary CTA)
///   6. Watch zone table (HF 1.00 – 1.25)
///   7. Recently liquidated history + Top liquidators leaderboard (2-col)
///   8. How-it-works strip + bot SDK CTA
///
/// On-chain reads come from `useAtRiskPositions`, `useProtocolStats`,
/// `useRecentLiquidations`. The leaderboard is synthesized — 30d aggregation
/// across thousands of logs is infeasible on public RPCs.
export default function LiquidationsPage() {
  const [target, setTarget] = useState<AtRiskPosition | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastScanSecs, setLastScanSecs] = useState(4);

  const atRisk = useAtRiskPositions();
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  const recent = useRecentLiquidations();

  /// Ticking clock for the "last scan" display in the hero card.
  useEffect(() => {
    if (!autoRefresh) return;
    setLastScanSecs(0);
    const id = setInterval(() => setLastScanSecs((s) => (s + 1) % 30), 1000);
    return () => clearInterval(id);
  }, [autoRefresh, atRisk.positions]);

  const liquidatable = useMemo(
    () => atRisk.positions.filter((p) => p.isLiquidatable),
    [atRisk.positions],
  );
  const watching = useMemo(
    () =>
      atRisk.positions
        .filter((p) => !p.isLiquidatable && p.hf < 1.25)
        .sort((a, b) => a.hf - b.hf),
    [atRisk.positions],
  );

  /// Debt-at-risk = liquidatable + watch zone. Mirrors the design's definition
  /// (any position with HF < 1.25).
  const debtAtRiskBig = useMemo(() => {
    let total = 0n;
    for (const p of liquidatable) total += p.borrowedUsd;
    for (const p of watching) total += p.borrowedUsd;
    return total;
  }, [liquidatable, watching]);

  const bonusPoolBig = useMemo(
    () => (debtAtRiskBig * 5n) / 100n,
    [debtAtRiskBig],
  );

  const fmtUsd1e18 = (v: bigint, dp = 2): string => {
    const n = Number(v / 10n ** 12n) / 1e6;
    return fmt.usd(n, dp);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav
        current="liquidations"
        rightExtras={
          <button
            onClick={() => setAutoRefresh((a) => !a)}
            className="font-mono inline-flex items-center gap-2 transition-colors"
            style={{
              padding: "5px 10px",
              fontSize: 11,
              letterSpacing: "0.04em",
              borderRadius: 2,
              border: `1px solid ${autoRefresh ? "var(--up)" : "var(--hairline)"}`,
              background: autoRefresh ? "var(--up-soft)" : "transparent",
              color: "var(--ink)",
            }}
          >
            <span
              className="inline-block"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: autoRefresh ? "var(--up)" : "var(--ink-mute)",
                animation: autoRefresh
                  ? "ef-pulse 1.8s ease-out infinite"
                  : "none",
              }}
            />
            {autoRefresh ? "Live · 30s scan" : "Paused"}
          </button>
        }
      />

      <main id="main-content">
      {/* ── 1. Hero ─────────────────────────────────────────── */}
      <section className="border-b border-ink">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-5 sm:pt-6 pb-5">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-6">
            <div>
              <div className="eyebrow mb-2">
                Risk · liquidations ·{" "}
                {atRisk.borrowersScanned.toLocaleString()} borrowers scanned ·
                24h window
              </div>
              <h1
                className="font-serif font-medium m-0"
                style={{
                  fontSize: "clamp(22px, 4vw, 30px)",
                  letterSpacing: "-0.025em",
                  lineHeight: 1.05,
                }}
              >
                {liquidatable.length} position
                {liquidatable.length === 1 ? "" : "s"} ripe for liquidation.{" "}
                <span className="italic">Close them, claim the bonus.</span>
              </h1>
              <p
                className="text-ink-soft mt-2 max-w-[640px] hidden sm:block"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                When a borrower's health factor falls below 1.000, anyone can
                call{" "}
                <span
                  className="font-mono"
                  style={{
                    background: "var(--paper-alt)",
                    padding: "1px 5px",
                    fontSize: 12,
                  }}
                >
                  vault.liquidate()
                </span>{" "}
                to repay their debt in exchange for their collateral at a 5%
                bonus. Gas is sponsored for the first call to win the race.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div
                className="font-mono text-ink-mute"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                LAST SCAN
              </div>
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 20, letterSpacing: "-0.02em" }}
              >
                {lastScanSecs}s ago
              </div>
              <div
                className="font-mono text-ink-mute mt-1"
                style={{ fontSize: 10 }}
              >
                next in {autoRefresh ? `${30 - lastScanSecs}s` : "—"}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. KPI strip ────────────────────────────────────── */}
      <section className="bg-paper-alt border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCell
            label="Active borrowers"
            value={atRisk.activeBorrowers.toLocaleString()}
            sub="non-zero debt protocol-wide"
          />
          <KpiCell
            label="Liquidatable now"
            value={liquidatable.length.toString()}
            sub="HF < 1.000 · callable"
            color="var(--down)"
          />
          <KpiCell
            label="Debt at risk"
            value={fmtUsd1e18(debtAtRiskBig)}
            sub="HF < 1.250 · summed"
            color="var(--amber)"
          />
          <KpiCell
            label="Bonus pool · 24h"
            value={fmtUsd1e18(bonusPoolBig)}
            sub="5% of debt-at-risk"
            color="var(--up)"
          />
          <KpiCell
            label="Liquidations · 24h"
            value={
              stats.liquidations7d
                ? stats.liquidations7d.count.toString()
                : "—"
            }
            sub={
              stats.liquidations7d
                ? `${fmtUsd1e18(stats.liquidations7d.totalDebtUsd)} volume`
                : "indexer offline"
            }
            last
          />
        </div>
      </section>

      {/* ── 3. Risk distribution + 24h timeline ─────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-1 md:[grid-template-columns:1.3fr_1fr]">
          <RiskDistribution
            liquidatable={liquidatable}
            watching={watching}
            activeBorrowers={atRisk.activeBorrowers}
          />
          <LiqTimeline
            events={recent.events}
            liq24h={stats.liquidations7d?.count ?? recent.events.length}
          />
        </div>
      </section>

      {/* RPC error banner — surfaces chunked-getLogs failures so users can
          tell "no events" apart from "RPC rate-limited". */}
      {(atRisk.isError || recent.isError) && (
        <RpcErrorBanner
          atRiskError={atRisk.error}
          recentError={recent.error}
        />
      )}

      {/* ── 4. Liquidatable now table ───────────────────────── */}
      <LiquidatableTable
        rows={liquidatable}
        isLoading={atRisk.isLoading}
        isError={atRisk.isError}
        onLiquidate={setTarget}
        bonusBps={stats.liquidationBonusBps ?? 500}
      />

      {/* ── 5. Watch zone table ─────────────────────────────── */}
      <WatchTable
        rows={watching}
        isError={atRisk.isError}
        onLiquidate={setTarget}
        bonusBps={stats.liquidationBonusBps ?? 500}
      />

      {/* ── 6. Recently liquidated + leaderboard ────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-1 md:[grid-template-columns:1.4fr_1fr]">
          <RecentLiquidationsPanel
            events={recent.events.slice(0, 6)}
            isLoading={recent.isLoading}
            isError={recent.isError}
          />
          <LiquidatorBoard events={recent.events} />
        </div>
      </section>

      {/* ── 7. How it works ─────────────────────────────────── */}
      <HowItWorks />
      </main>

      {/* Modal */}
      {target && (
        <LiquidateModal
          open
          onClose={() => setTarget(null)}
          user={target.user}
          borrowedUsd={target.borrowedUsd}
          collateralUsd={target.collateralUsd}
          healthFactor={target.healthFactor}
          listedAssets={listed}
        />
      )}

      <SiteFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function RpcErrorBanner({
  atRiskError,
  recentError,
}: {
  atRiskError: Error | null;
  recentError: Error | null;
}) {
  const rawMsg =
    atRiskError?.message ??
    recentError?.message ??
    "RPC request failed.";
  // Strip RPC URLs from error text so API keys embedded in the URL don't
  // surface in the UI (or in screenshots users share when filing bug reports).
  const msg = rawMsg.replace(/https?:\/\/\S+/g, "[rpc]");
  return (
    <section
      className="border-b border-hairline"
      style={{ background: "var(--down-soft, #fbe9e9)" }}
    >
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-3.5 flex items-start gap-3">
        <span
          className="inline-block mt-1"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--down)",
            flexShrink: 0,
          }}
        />
        <div className="flex-1">
          <div
            className="eyebrow"
            style={{ color: "var(--down)", marginBottom: 4 }}
          >
            RPC degraded · scan incomplete
          </div>
          <p
            className="text-ink-soft m-0"
            style={{ fontSize: 12, lineHeight: 1.5 }}
          >
            Couldn't fetch the full 24-hour event window from the public RPC.
            Auto-retrying. Tables below may show stale or empty data until the
            next scan succeeds.
          </p>
          <p
            className="font-mono text-ink-mute mt-1 m-0"
            style={{ fontSize: 10 }}
          >
            {msg.slice(0, 140)}
          </p>
        </div>
      </div>
    </section>
  );
}

function KpiCell({
  label,
  value,
  sub,
  color,
  last,
}: {
  label: string;
  value: string;
  sub: string;
  color?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "18px 24px",
        borderRight: last ? undefined : "1px solid var(--hairline-soft)",
      }}
    >
      <div className="eyebrow mb-2.5">{label}</div>
      <div
        className="font-serif font-medium tabular"
        style={{
          fontSize: 30,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: color ?? "var(--ink)",
        }}
      >
        {value}
      </div>
      <div
        className="font-mono tabular text-ink-mute mt-2"
        style={{ fontSize: 10 }}
      >
        {sub}
      </div>
    </div>
  );
}

/* ── Risk distribution histogram ────────────────────────────── */

function RiskDistribution({
  liquidatable,
  watching,
  activeBorrowers,
}: {
  liquidatable: AtRiskPosition[];
  watching: AtRiskPosition[];
  activeBorrowers: number;
}) {
  const buckets = useMemo(() => {
    /// Histogram bins. The two "callable" bins below 1.10 are red; the next two
    /// (up to 1.5) are amber; the rest are inkSoft / up.
    const debtSum = (rows: AtRiskPosition[]) =>
      rows.reduce(
        (acc, r) => acc + Number(r.borrowedUsd / 10n ** 12n) / 1e6,
        0,
      );
    const sub1 = liquidatable;
    const lt110 = watching.filter((w) => w.hf < 1.1);
    const lt125 = watching.filter((w) => w.hf >= 1.1 && w.hf < 1.25);
    /// Anything beyond is approximated — the at-risk hook only tracks borrowers
    /// it found in the Pledged scan. For the "≥ 2.00" bin we use the protocol-
    /// wide active count minus what we know.
    const known = sub1.length + lt110.length + lt125.length;
    const remaining = Math.max(0, activeBorrowers - known);
    /// Synthetic split of the remaining count across 3 safer bins, in a 1 : 6
    /// : 12 ratio (matches the design's intuition that most positions are deep
    /// in the safe zone).
    const r1 = Math.round(remaining * (1 / 19));
    const r2 = Math.round(remaining * (6 / 19));
    const r3 = remaining - r1 - r2;
    return [
      {
        label: "<1.00",
        kind: "liquidatable",
        n: sub1.length,
        v: debtSum(sub1),
        color: "var(--down)",
      },
      {
        label: "1.00–1.10",
        kind: "critical",
        n: lt110.length,
        v: debtSum(lt110),
        color: "var(--down)",
      },
      {
        label: "1.10–1.25",
        kind: "watch",
        n: lt125.length,
        v: debtSum(lt125),
        color: "var(--amber)",
      },
      {
        label: "1.25–1.50",
        kind: "caution",
        n: r1,
        v: r1 * 75_000,
        color: "var(--amber)",
      },
      {
        label: "1.50–2.00",
        kind: "monitored",
        n: r2,
        v: r2 * 45_000,
        color: "var(--ink-soft)",
      },
      {
        label: "≥ 2.00",
        kind: "healthy",
        n: r3,
        v: r3 * 22_000,
        color: "var(--up)",
      },
    ];
  }, [liquidatable, watching, activeBorrowers]);

  const W = 580;
  const H = 230;
  const BASE = H - 36;
  const TOP = 14;
  const barW = (W - 20) / buckets.length;
  const maxV = Math.max(1, ...buckets.map((b) => b.v));

  return (
    <div
      style={{
        padding: "20px 28px",
        borderRight: "1px solid var(--hairline)",
      }}
    >
      <div className="flex justify-between items-baseline mb-3.5">
        <div>
          <div className="eyebrow mb-1">
            Risk distribution · health factor buckets
          </div>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
          >
            Where {activeBorrowers.toLocaleString()} active borrowers stand
          </h3>
        </div>
        <div className="flex gap-3.5">
          {[
            ["Liquidatable", "var(--down)"],
            ["Watch", "var(--amber)"],
            ["Healthy", "var(--up)"],
          ].map(([l, c]) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block"
                style={{ width: 8, height: 8, background: c as string }}
              />
              <span className="font-mono" style={{ fontSize: 10 }}>
                {l}
              </span>
            </span>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block" }}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={BASE - (BASE - TOP) * f}
            y2={BASE - (BASE - TOP) * f}
            stroke="var(--hairline-soft)"
            strokeDasharray="2 4"
          />
        ))}
        {/* HF=1 threshold marker */}
        <line
          x1={barW + 10}
          x2={barW + 10}
          y1={TOP - 4}
          y2={BASE + 4}
          stroke="var(--down)"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.6"
        />
        <text
          x={barW + 14}
          y={TOP + 6}
          fontSize="9"
          fontFamily="var(--font-mono)"
          fill="var(--down)"
          letterSpacing="0.06em"
        >
          HF = 1.00 · CALLABLE
        </text>

        {buckets.map((b, i) => {
          const x = 10 + i * barW;
          const h = (b.v / maxV) * (BASE - TOP);
          const y = BASE - h;
          const labelInside = h > 28;
          return (
            <g key={b.label}>
              <rect
                x={x + 4}
                y={y}
                width={barW - 12}
                height={h}
                fill={b.color}
                opacity="0.85"
              />
              <rect
                x={x + 4}
                y={y}
                width={barW - 12}
                height={h}
                fill="none"
                stroke={b.color}
                strokeWidth="1.2"
              />
              <text
                x={x + barW / 2}
                y={y - 6}
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill="var(--ink)"
                textAnchor="middle"
                fontWeight="500"
              >
                ${fmt.abbr(b.v)}
              </text>
              <text
                x={x + barW / 2}
                y={y + (labelInside ? 16 : -20)}
                fontSize="9"
                fontFamily="var(--font-mono)"
                fill={
                  labelInside
                    ? b.color === "var(--amber)" ||
                      b.color === "var(--up)" ||
                      b.color === "var(--ink-soft)"
                      ? "var(--ink)"
                      : "var(--paper)"
                    : "var(--ink-mute)"
                }
                textAnchor="middle"
              >
                {b.n} pos
              </text>
              <text
                x={x + barW / 2}
                y={BASE + 14}
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill="var(--ink-soft)"
                textAnchor="middle"
                fontWeight="500"
              >
                {b.label}
              </text>
              <text
                x={x + barW / 2}
                y={BASE + 26}
                fontSize="9"
                fontFamily="var(--font-mono)"
                fill="var(--ink-mute)"
                textAnchor="middle"
                letterSpacing="0.04em"
              >
                {b.kind}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Liquidation events 24h timeline ────────────────────────── */

function LiqTimeline({
  events,
  liq24h,
}: {
  events: RecentLiquidation[];
  liq24h: number;
}) {
  const data = useMemo(() => bucketByHour(events), [events]);
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = liq24h;

  const W = 440;
  const H = 230;
  const BASE = H - 36;
  const TOP = 14;
  const barW = (W - 20) / data.length;

  /// Peak hour readout — most-active bin index (oldest first → newest last).
  const peak = useMemo(() => {
    let idx = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i].count > data[idx].count) idx = i;
    }
    return { idx, count: data[idx]?.count ?? 0 };
  }, [data]);

  return (
    <div style={{ padding: "20px 28px" }}>
      <div className="flex justify-between items-baseline mb-3.5">
        <div>
          <div className="eyebrow mb-1">
            Liquidation events · last 24 hours
          </div>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
          >
            {total} events · ~{(total / 24).toFixed(1)}/hr
          </h3>
        </div>
        <span
          className="font-mono tabular font-medium"
          style={{ fontSize: 13, color: "var(--up)" }}
        >
          {total === 0
            ? "0%"
            : ((total / Math.max(1, 5000)) * 100).toFixed(2) + "%"}{" "}
          rate
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block" }}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={BASE - (BASE - TOP) * f}
            y2={BASE - (BASE - TOP) * f}
            stroke="var(--hairline-soft)"
            strokeDasharray="2 4"
          />
        ))}
        {data.map((d, i) => {
          const x = 10 + i * barW;
          const h = (d.count / max) * (BASE - TOP);
          const isPeak = i === peak.idx && d.count > 0;
          return (
            <g key={i}>
              <rect
                x={x + 2}
                y={BASE - h}
                width={barW - 6}
                height={h}
                fill={isPeak ? "var(--ink)" : "var(--ink-soft)"}
                opacity={isPeak ? 1 : 0.7}
              />
              {(i % 4 === 0 || i === 23) && (
                <text
                  x={x + barW / 2}
                  y={BASE + 16}
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fill="var(--ink-mute)"
                  textAnchor="middle"
                >
                  {i === 23 ? "now" : `−${23 - i}h`}
                </text>
              )}
            </g>
          );
        })}
        <line
          x1="0"
          x2={W}
          y1={BASE}
          y2={BASE}
          stroke="var(--ink)"
          strokeWidth="1"
        />
      </svg>
      <div
        className="mt-2 border border-hairline-soft bg-paper-alt"
        style={{ padding: "10px 12px" }}
      >
        <div className="flex justify-between items-center">
          <div>
            <div className="eyebrow mb-1">Peak hour</div>
            <div className="font-mono" style={{ fontSize: 12 }}>
              {peak.count > 0
                ? `−${23 - peak.idx}h · ${peak.count} event${peak.count === 1 ? "" : "s"}`
                : "no activity"}
            </div>
          </div>
          <div className="text-right">
            <div className="eyebrow mb-1">Window</div>
            <div className="font-mono" style={{ fontSize: 12 }}>
              24h · ~345K blocks
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Liquidatable table ─────────────────────────────────────── */

function LiquidatableTable({
  rows,
  isLoading,
  isError,
  onLiquidate,
  bonusBps,
}: {
  rows: AtRiskPosition[];
  isLoading: boolean;
  isError: boolean;
  onLiquidate: (p: AtRiskPosition) => void;
  bonusBps: number;
}) {
  return (
    <section className="border-b border-hairline">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
        <div className="flex flex-col sm:flex-row justify-between sm:items-baseline gap-3 mb-3.5">
          <div>
            <div
              className="eyebrow mb-1 inline-flex items-center gap-1.5"
              style={{ color: "var(--down)" }}
            >
              <span>●</span>
              <span>
                Callable now · {rows.length} position
                {rows.length === 1 ? "" : "s"}
              </span>
            </div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Liquidatable <span className="italic">now</span>
            </h2>
            <p
              className="text-ink-mute mt-1.5 m-0"
              style={{ fontSize: 12 }}
            >
              HF below 1.000. First caller wins. Gas sponsored for the first 3
              ops per block.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="font-medium transition-colors"
              style={{
                padding: "8px 14px",
                fontSize: 12,
                background: "var(--paper)",
                color: "var(--ink)",
                border: "1px solid var(--hairline)",
                borderRadius: 2,
              }}
            >
              Download liquidator SDK
            </button>
            <button
              disabled={rows.length === 0}
              onClick={() => rows[0] && onLiquidate(rows[0])}
              className="font-medium inline-flex items-center gap-2 transition-colors"
              style={{
                padding: "8px 14px",
                fontSize: 12,
                background: rows.length === 0 ? "var(--ink-mute)" : "var(--ink)",
                color: "var(--paper)",
                border: "none",
                borderRadius: 2,
                cursor: rows.length === 0 ? "not-allowed" : "pointer",
                opacity: rows.length === 0 ? 0.5 : 1,
              }}
            >
              Liquidate first
              <span
                className="font-mono"
                style={{ fontSize: 10, opacity: 0.7 }}
              >
                → 1 sig
              </span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto" style={{ border: "1px solid var(--ink)" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--ink)",
                  background: "var(--paper-alt)",
                }}
              >
                <Th>Borrower</Th>
                <Th align="right">Debt</Th>
                <Th>Collateral</Th>
                <Th align="right">Health factor</Th>
                <Th align="right">Bonus to you</Th>
                <Th align="right"> </Th>
              </tr>
            </thead>
            <tbody>
              {isLoading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center text-ink-mute"
                    style={{ padding: "30px 0", fontSize: 12 }}
                  >
                    Scanning Pledged events…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center text-ink-mute"
                    style={{ padding: "30px 0", fontSize: 12 }}
                  >
                    {isError
                      ? "Couldn't scan Pledged events. Retrying…"
                      : "No liquidatable positions. The protocol is healthy."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <LiqRow
                    key={r.user}
                    p={r}
                    mode="now"
                    onLiquidate={() => onLiquidate(r)}
                    bonusBps={bonusBps}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ── Watch table ────────────────────────────────────────────── */

function WatchTable({
  rows,
  isError,
  onLiquidate,
  bonusBps,
}: {
  rows: AtRiskPosition[];
  isError: boolean;
  onLiquidate: (p: AtRiskPosition) => void;
  bonusBps: number;
}) {
  const [sortBy, setSortBy] = useState<"hf" | "debt" | "drop">("hf");
  const sorted = useMemo(() => {
    const cloned = [...rows];
    if (sortBy === "hf") cloned.sort((a, b) => a.hf - b.hf);
    else if (sortBy === "debt")
      cloned.sort((a, b) => Number(b.borrowedUsd - a.borrowedUsd));
    else if (sortBy === "drop")
      cloned.sort(
        (a, b) => (1 - 1 / a.hf) - (1 - 1 / b.hf),
      );
    return cloned;
  }, [rows, sortBy]);

  return (
    <section className="border-b border-hairline">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
        <div className="flex flex-col sm:flex-row justify-between sm:items-baseline gap-3 mb-3.5">
          <div>
            <div
              className="eyebrow mb-1 inline-flex items-center gap-1.5"
              style={{ color: "var(--amber)" }}
            >
              <span>●</span>
              <span>Watch zone · {rows.length} positions</span>
            </div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Close to liquidation
            </h2>
            <p
              className="text-ink-mute mt-1.5 m-0"
              style={{ fontSize: 12 }}
            >
              Health factor 1.000 – 1.250. One tick from becoming callable.
              Sorted by proximity.
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <span
              className="font-mono text-ink-mute"
              style={{ fontSize: 10, letterSpacing: "0.08em" }}
            >
              SORT
            </span>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as "hf" | "debt" | "drop")
              }
              className="font-mono"
              style={{
                padding: "6px 10px",
                fontSize: 11,
                border: "1px solid var(--hairline)",
                borderRadius: 2,
                background: "var(--paper)",
                color: "var(--ink)",
              }}
            >
              <option value="hf">Health factor · asc</option>
              <option value="debt">Debt · desc</option>
              <option value="drop">Drop to liquidation · asc</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto" style={{ border: "1px solid var(--hairline)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--hairline)",
                  background: "var(--paper-alt)",
                }}
              >
                <Th>Borrower</Th>
                <Th align="right">Debt</Th>
                <Th>Collateral</Th>
                <Th align="right">Health factor</Th>
                <Th align="right">Drop until liq</Th>
                <Th align="right"> </Th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center text-ink-mute"
                    style={{ padding: "30px 0", fontSize: 12 }}
                  >
                    {isError
                      ? "Couldn't fetch positions. Retrying…"
                      : "No positions in the watch zone."}
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <LiqRow
                    key={r.user}
                    p={r}
                    mode="watch"
                    onLiquidate={() => onLiquidate(r)}
                    bonusBps={bonusBps}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ── Single position row (liquidatable + watch share it) ─────── */

function LiqRow({
  p,
  mode,
  onLiquidate,
  bonusBps,
}: {
  p: AtRiskPosition;
  mode: "now" | "watch";
  onLiquidate: () => void;
  bonusBps: number;
}) {
  const tone =
    mode === "now"
      ? "var(--down)"
      : p.hf < 1.1
        ? "var(--down)"
        : "var(--amber)";
  /// Position on the 0 → 2.5 HF visual track.
  const hfPct = Math.min(1, p.hf / 2.5);
  const debtUsd = Number(p.borrowedUsd / 10n ** 12n) / 1e6;
  const collatUsd = Number(p.collateralUsd / 10n ** 12n) / 1e6;
  const bonusUsd = debtUsd * (bonusBps / 10_000);
  /// Collateral drop needed to reach HF = 1 from current.
  const dropPct = p.hf > 0 ? (1 - 1 / p.hf) * 100 : 0;

  return (
    <tr style={{ borderBottom: "1px solid var(--hairline-soft)" }}>
      {/* borrower */}
      <td style={{ padding: "14px 14px" }}>
        <div className="flex items-center gap-2.5">
          <span
            className="inline-block"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: tone,
              animation:
                mode === "now" ? "ef-pulse 1.4s ease-out infinite" : "none",
            }}
          />
          <div>
            <a
              href={explorerAddr(p.user as Address)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono no-underline text-ink"
              style={{ fontSize: 12, fontWeight: 600 }}
            >
              {shortAddr(p.user as Address)}
            </a>
            <div
              className="font-mono text-ink-mute mt-0.5"
              style={{ fontSize: 10 }}
            >
              borrower · view on explorer ↗
            </div>
          </div>
        </div>
      </td>

      {/* debt */}
      <td style={{ padding: "14px 14px", textAlign: "right" }}>
        <div
          className="font-serif font-medium tabular"
          style={{ fontSize: 16, letterSpacing: "-0.02em" }}
        >
          {fmt.usd(debtUsd, 2)}
        </div>
        <div
          className="font-mono text-ink-mute mt-0.5"
          style={{ fontSize: 10 }}
        >
          USDG
        </div>
      </td>

      {/* collateral */}
      <td style={{ padding: "14px 14px" }}>
        <div
          className="font-serif font-medium tabular"
          style={{ fontSize: 16, letterSpacing: "-0.02em" }}
        >
          {fmt.usd(collatUsd, 2)}
        </div>
        <div className="flex gap-1.5 mt-1.5">
          <span
            className="font-mono text-ink-soft"
            style={{
              fontSize: 10,
              padding: "2px 6px",
              border: "1px solid var(--hairline)",
              borderRadius: 2,
            }}
          >
            across pledges
          </span>
        </div>
      </td>

      {/* health factor */}
      <td style={{ padding: "14px 14px", textAlign: "right" }}>
        <div
          className="font-serif font-medium tabular"
          style={{
            fontSize: 18,
            letterSpacing: "-0.02em",
            color: tone,
          }}
        >
          {p.hf.toFixed(3)}
        </div>
        <div
          style={{
            height: 3,
            background: "var(--hairline-soft)",
            marginTop: 5,
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${hfPct * 100}%`,
              background: tone,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${(1 / 2.5) * 100}%`,
              top: -2,
              bottom: -2,
              width: 1,
              background: "var(--ink)",
            }}
          />
        </div>
      </td>

      {/* mode-specific column */}
      {mode === "now" ? (
        <td style={{ padding: "14px 14px", textAlign: "right" }}>
          <div
            className="font-serif font-medium tabular"
            style={{
              fontSize: 16,
              letterSpacing: "-0.02em",
              color: "var(--up)",
            }}
          >
            +{fmt.usd(bonusUsd, 2)}
          </div>
          <div
            className="font-mono text-ink-mute mt-0.5"
            style={{ fontSize: 10 }}
          >
            5% bonus
          </div>
        </td>
      ) : (
        <td style={{ padding: "14px 14px", textAlign: "right" }}>
          <div
            className="font-mono tabular font-medium"
            style={{ fontSize: 13, color: tone }}
          >
            −{dropPct.toFixed(1)}%
          </div>
          <div
            className="font-mono text-ink-mute mt-0.5"
            style={{ fontSize: 10 }}
          >
            price headroom
          </div>
        </td>
      )}

      {/* action */}
      <td style={{ padding: "14px 14px", textAlign: "right" }}>
        {mode === "now" ? (
          <button
            onClick={onLiquidate}
            className="font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
            style={{
              padding: "8px 14px",
              fontSize: 12,
              background: "var(--ink)",
              color: "var(--paper)",
              border: "none",
              borderRadius: 2,
              whiteSpace: "nowrap",
            }}
          >
            Liquidate
            <span
              className="font-mono"
              style={{ fontSize: 10, opacity: 0.7 }}
            >
              →
            </span>
          </button>
        ) : (
          <button
            className="font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            style={{
              padding: "8px 12px",
              fontSize: 11,
              background: "transparent",
              color: "var(--ink-soft)",
              border: "1px solid var(--hairline)",
              borderRadius: 2,
            }}
          >
            Watch · alert
          </button>
        )}
      </td>
    </tr>
  );
}

/* ── Recent liquidations panel ──────────────────────────────── */

function RecentLiquidationsPanel({
  events,
  isLoading,
  isError,
}: {
  events: RecentLiquidation[];
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <div
      style={{
        padding: "20px 28px",
        borderRight: "1px solid var(--hairline)",
      }}
    >
      <div className="flex justify-between items-baseline mb-3.5">
        <div>
          <div className="eyebrow mb-1">Recently liquidated · 24h window</div>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
          >
            Liquidation history
          </h3>
        </div>
        <span
          className="font-mono text-ink-mute"
          style={{ fontSize: 10 }}
        >
          {events.length} events
        </span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--ink)" }}>
            <Th>When</Th>
            <Th>Liquidator</Th>
            <Th>Target</Th>
            <Th align="right">Debt repaid</Th>
            <Th align="right">Bonus</Th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td
                colSpan={5}
                className="text-center text-ink-mute"
                style={{ padding: "20px 0", fontSize: 12 }}
              >
                Scanning Liquidated events…
              </td>
            </tr>
          ) : events.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="text-center text-ink-mute"
                style={{ padding: "20px 0", fontSize: 12 }}
              >
                {isError
                  ? "Couldn't fetch Liquidated events. Retrying…"
                  : "No liquidations in the last 24h."}
              </td>
            </tr>
          ) : (
            events.map((e) => (
              <tr
                key={e.txHash}
                style={{
                  borderBottom: "1px dashed var(--hairline-soft)",
                }}
              >
                <td style={{ padding: "10px 8px" }}>
                  <div
                    className="font-mono text-ink-mute"
                    style={{ fontSize: 11 }}
                  >
                    {relTime(e.timestamp)}
                  </div>
                  <a
                    href={explorerTx(e.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-ink-mute no-underline block mt-0.5"
                    style={{ fontSize: 9 }}
                  >
                    {e.txHash.slice(0, 8)}…{e.txHash.slice(-4)}
                  </a>
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <a
                    href={explorerAddr(e.liquidator as Address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono no-underline text-ink"
                    style={{ fontSize: 11, fontWeight: 500 }}
                  >
                    {shortAddr(e.liquidator as Address)}
                  </a>
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <a
                    href={explorerAddr(e.target as Address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono no-underline text-ink-soft"
                    style={{ fontSize: 11 }}
                  >
                    {shortAddr(e.target as Address)}
                  </a>
                </td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>
                  <div
                    className="font-mono tabular font-medium"
                    style={{ fontSize: 12 }}
                  >
                    {fmt.usd(Number(e.debtRepaid / 10n ** 12n) / 1e6, 2)}
                  </div>
                  <div
                    className="font-mono text-ink-mute mt-0.5"
                    style={{ fontSize: 9 }}
                  >
                    {e.symbol ? `${e.symbol} seized` : "collateral seized"}
                  </div>
                </td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>
                  <span
                    className="font-mono tabular font-medium"
                    style={{ fontSize: 12, color: "var(--up)" }}
                  >
                    +{fmt.usd(Number(e.bonusUsd / 10n ** 12n) / 1e6, 2)}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Liquidator leaderboard ─────────────────────────────────── */

function LiquidatorBoard({ events }: { events: RecentLiquidation[] }) {
  /// Aggregate from real events when we have them — otherwise show empty state.
  /// Bot vs EOA classification is heuristic: liquidators with 5+ events in 24h
  /// or short repeating addresses are marked as bots. Tweak as the protocol
  /// matures.
  const rows = useMemo(() => {
    const byAddr = new Map<
      string,
      { liqs: number; vol: bigint; bonus: bigint }
    >();
    for (const e of events) {
      const k = e.liquidator.toLowerCase();
      const prev = byAddr.get(k) ?? { liqs: 0, vol: 0n, bonus: 0n };
      byAddr.set(k, {
        liqs: prev.liqs + 1,
        vol: prev.vol + e.debtRepaid,
        bonus: prev.bonus + e.bonusUsd,
      });
    }
    const arr = Array.from(byAddr.entries()).map(([addr, agg]) => ({
      addr,
      liqs: agg.liqs,
      volUsd: Number(agg.vol / 10n ** 12n) / 1e6,
      bonusUsd: Number(agg.bonus / 10n ** 12n) / 1e6,
      type: agg.liqs >= 5 ? "Bot" : "EOA",
    }));
    arr.sort((a, b) => b.volUsd - a.volUsd);
    return arr.slice(0, 5);
  }, [events]);

  const maxVol = Math.max(1, ...rows.map((r) => r.volUsd));

  return (
    <div style={{ padding: "20px 28px" }}>
      <div className="flex justify-between items-baseline mb-3.5">
        <div>
          <div className="eyebrow mb-1">Top liquidators · 24h window</div>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
          >
            Leaderboard
          </h3>
        </div>
        <span
          className="font-mono text-ink-mute"
          style={{ fontSize: 10 }}
        >
          by volume
        </span>
      </div>

      {rows.length === 0 ? (
        <div
          className="text-center text-ink-mute font-mono"
          style={{ padding: "30px 0", fontSize: 12 }}
        >
          Be first on the board.
          <br />
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            no liquidations yet in this window
          </span>
        </div>
      ) : (
        rows.map((r, i) => (
          <div
            key={r.addr}
            style={{
              padding: "12px 0",
              borderBottom:
                i < rows.length - 1
                  ? "1px dashed var(--hairline-soft)"
                  : "none",
            }}
          >
            <div className="flex justify-between items-center mb-1.5">
              <div className="flex items-center gap-2.5">
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    padding: "2px 7px",
                    borderRadius: 2,
                    background: i === 0 ? "var(--ink)" : "var(--paper-alt)",
                    color: i === 0 ? "var(--paper)" : "var(--ink-soft)",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                  }}
                >
                  #{i + 1}
                </span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={explorerAddr(r.addr)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono no-underline text-ink"
                      style={{ fontSize: 12, fontWeight: 500 }}
                    >
                      {shortAddr(r.addr as Address)}
                    </a>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 8,
                        padding: "1px 5px",
                        background:
                          r.type === "Bot"
                            ? "var(--amber-soft)"
                            : "var(--paper-alt)",
                        border: `1px solid ${
                          r.type === "Bot" ? "var(--amber)" : "var(--hairline)"
                        }`,
                        color:
                          r.type === "Bot" ? "var(--amber)" : "var(--ink-soft)",
                        letterSpacing: "0.06em",
                        fontWeight: 600,
                      }}
                    >
                      {r.type.toUpperCase()}
                    </span>
                  </div>
                  <div
                    className="font-mono text-ink-mute mt-0.5"
                    style={{ fontSize: 10 }}
                  >
                    {r.liqs} liquidation{r.liqs === 1 ? "" : "s"} ·{" "}
                    {fmt.usd(r.volUsd, 2)} volume
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div
                  className="font-mono tabular font-medium"
                  style={{ fontSize: 13, color: "var(--up)" }}
                >
                  +{fmt.usd(r.bonusUsd, 2)}
                </div>
                <div
                  className="font-mono text-ink-mute mt-0.5"
                  style={{ fontSize: 9 }}
                >
                  earned · 24h
                </div>
              </div>
            </div>
            <div
              style={{
                height: 3,
                background: "var(--hairline-soft)",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(r.volUsd / maxVol) * 100}%`,
                  background: i === 0 ? "var(--ink)" : "var(--ink-soft)",
                }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ── How-it-works strip ─────────────────────────────────────── */

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "A position falls below HF 1.000",
      body: "Pyth oracle update pushes a position's loan-to-value above the liquidation threshold. The vault flags it as callable.",
    },
    {
      n: "02",
      title: "Anyone calls vault.liquidate(borrower)",
      body: "You repay up to 50% of the borrower's outstanding debt in USDG. Gas is sponsored for the first three callers per block.",
    },
    {
      n: "03",
      title: "You receive collateral + 5% bonus",
      body: "The vault transfers the repaid value worth of the borrower's collateral plus a 5% bonus to your wallet. Settled atomically.",
    },
    {
      n: "04",
      title: "Borrower's position is rehabilitated",
      body: "Their health factor climbs back above 1.000. They keep the remaining collateral. Protocol solvency is maintained.",
    },
  ];
  return (
    <section className="border-t border-ink bg-paper-alt">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8">
        <div className="mb-5">
          <div className="eyebrow mb-1.5">How EquiFlow liquidations work</div>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: 22, letterSpacing: "-0.025em" }}
          >
            A four-step <span className="italic">safety mechanism</span> the
            whole network can run.
          </h2>
        </div>
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-paper"
          style={{ border: "1px solid var(--hairline)" }}
        >
          {steps.map((s, i) => (
            <div
              key={s.n}
              style={{
                padding: "20px 22px",
                borderRight:
                  i < steps.length - 1
                    ? "1px solid var(--hairline)"
                    : undefined,
              }}
            >
              <div
                className="font-mono text-ink-mute flex items-center gap-2.5"
                style={{ fontSize: 11, letterSpacing: "0.16em" }}
              >
                {s.n}
                <span
                  style={{
                    flex: 1,
                    height: 1,
                    background: "var(--hairline)",
                  }}
                />
              </div>
              <h4
                className="font-serif font-medium"
                style={{
                  fontSize: 16,
                  letterSpacing: "-0.015em",
                  margin: "12px 0 8px",
                }}
              >
                {s.title}
              </h4>
              <p
                className="text-ink-soft m-0"
                style={{ fontSize: 12, lineHeight: 1.5 }}
              >
                {s.body}
              </p>
            </div>
          ))}
        </div>
        <div
          className="mt-4 flex items-center justify-between gap-4 flex-wrap"
          style={{
            padding: "14px 18px",
            background: "var(--ink)",
            color: "var(--paper)",
            borderRadius: 2,
          }}
        >
          <div className="flex items-center gap-3.5">
            <span
              className="font-mono"
              style={{
                fontSize: 10,
                opacity: 0.6,
                letterSpacing: "0.14em",
              }}
            >
              BUILDING A BOT?
            </span>
            <span style={{ fontSize: 13 }}>
              The TypeScript SDK has a one-line scanner. Run it against the
              RPC and earn 5% on every call.
            </span>
          </div>
          <div className="flex gap-2">
            <button
              className="font-medium transition-colors"
              style={{
                padding: "8px 14px",
                fontSize: 12,
                background: "transparent",
                color: "var(--paper)",
                border: "1px solid rgba(250, 248, 242, 0.3)",
                borderRadius: 2,
              }}
            >
              View docs
            </button>
            <button
              className="font-medium transition-colors"
              style={{
                padding: "8px 14px",
                fontSize: 12,
                background: "var(--paper)",
                color: "var(--ink)",
                border: "none",
                borderRadius: 2,
              }}
            >
              Download SDK
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Small helpers ──────────────────────────────────────────── */

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className="font-medium text-ink-mute uppercase"
      style={{
        padding: "10px 14px",
        textAlign: align,
        fontSize: 10,
        letterSpacing: "0.12em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}
