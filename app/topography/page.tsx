"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageNav } from "@/components/PageNav";
import { OraclePing } from "@/components/OraclePing";
import { SiteFooter } from "@/components/SiteFooter";
import { STOCKS, type Stock, stockAddress, isLive } from "@/lib/config/stocks";
import { fmt } from "@/lib/format";
import { useLiveTick } from "@/lib/hooks/use-live-tick";
import { useLiveAdapterTick, useStockPrices } from "@/lib/hooks/use-adapter-price";
import { SessionBadge } from "@/components/SessionBadge";
import { useAssetConfigsMap } from "@/lib/hooks/use-asset-configs";
import { useListedAssets, useProtocolStats } from "@/lib/hooks/use-protocol-stats";
import { useRecommendedLtv } from "@/lib/hooks/use-recommended-ltv";
import { shortAddr, explorerAddr } from "@/lib/contracts";
import { AssetLogo } from "@/components/AssetLogo";
import { LtvBreakdown } from "@/components/LtvBreakdown";

type Mode = "vault" | "borrow" | "ltv";
type SortKey =
  | "sym"
  | "price"
  | "ltv"
  | "volatility";
type SortDir = "asc" | "desc";

export default function TopographyPage() {
  const [focus, setFocus] = useState("NVDA");
  const [mode, setMode] = useState<Mode>("vault");
  const [sortBy, setSortBy] = useState<SortKey>("price");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const stocks = STOCKS;
  const focused = stocks.find((s) => s.sym === focus) ?? stocks[0];

  /// Derived protocol-wide rates via kinked IRM (lib/irm.ts) — these replace
  /// the static per-asset averages because the vault is single-pool USDG.
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  const derivedBorrowApr =
    stats.derived ? stats.derived.borrowAprBps / 100 : null;
  const derivedVaultApr =
    stats.derived ? stats.derived.supplyAprBps / 100 : null;

  /// "Best vault" is now degenerate (all assets share the rate) but kept as a
  /// stat for the header. Reports the protocol rate + a symbol the focus
  /// panel defaults to; cosmetic only.
  const bestVault = derivedVaultApr ?? 0;
  const bestVaultSym = derivedVaultApr != null ? "all" : "—";
  const avgVault = derivedVaultApr ?? 0;
  const avgBorrow = derivedBorrowApr ?? 0;
  const totalLiquid =
    stats.liquidityUsd != null
      ? Number(stats.liquidityUsd) / 1e18
      : 0;
  const spread = avgVault - avgBorrow;

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav
        current="topography"
        rightExtras={<OraclePing label="7 feeds · 12s heartbeat" />}
      />

      <div className="max-w-[1320px] w-full mx-auto flex-1 flex flex-col">
        {/* Header */}
        <section
          className="border-b border-hairline-soft"
          style={{ padding: "24px 32px 18px" }}
        >
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="eyebrow mb-2">Markets · Yield topography</div>
              <h1
                className="font-serif font-medium m-0"
                style={{
                  fontSize: 30,
                  fontWeight: 500,
                  letterSpacing: "-0.025em",
                  lineHeight: 1.05,
                }}
              >
                Where your collateral can <em>climb</em>.
              </h1>
              <p
                className="text-ink-soft m-0"
                style={{
                  fontSize: 13,
                  marginTop: 8,
                  maxWidth: 580,
                  lineHeight: 1.55,
                }}
              >
                Each summit is a tokenized equity. Peak height shows the metric
                on the toggle — vault yield, borrow APR, or max LTV. Click any
                summit to focus its details.
              </p>
            </div>
            <div className="flex gap-1 p-[3px] border border-hairline rounded-[2px]">
              {(
                [
                  ["vault", "Vault APR"],
                  ["borrow", "Borrow APR"],
                  ["ltv", "Max LTV"],
                ] as [Mode, string][]
              ).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setMode(k)}
                  className="border-0 rounded-[2px] transition-colors"
                  style={{
                    padding: "7px 12px",
                    fontSize: 12,
                    background: mode === k ? "var(--ink)" : "transparent",
                    color: mode === k ? "var(--paper)" : "var(--ink-soft)",
                    fontWeight: mode === k ? 500 : 400,
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* KPI strip */}
        <section className="grid grid-cols-5 border-b border-hairline bg-paper-alt">
          <KpiCell
            label="Best vault yield"
            value={"+" + bestVault.toFixed(2) + "%"}
            sub={`on ${bestVaultSym}`}
            color="var(--up)"
          />
          <KpiCell
            label="Avg. vault APR"
            value={"+" + avgVault.toFixed(2) + "%"}
            sub="weighted blended"
          />
          <KpiCell
            label="Avg. borrow APR"
            value={avgBorrow.toFixed(2) + "%"}
            sub={`spread +${spread.toFixed(2)}%`}
          />
          <KpiCell
            label="Total liquidity"
            value={"$" + fmt.abbr(totalLiquid)}
            sub={`${stocks.length} markets`}
          />
          <KpiCell
            label="Markets online"
            value={stocks.length + " / " + stocks.length}
            sub="Pyth · all live"
            color="var(--up)"
            last
          />
        </section>

        {/* Terrain + Markets table (left) · Asset deep dive (right) */}
        <section
          className="grid border-t border-hairline"
          style={{ gridTemplateColumns: "1fr 380px" }}
        >
          <div className="flex flex-col border-r border-hairline">
            <Terrain
              stocks={stocks}
              focus={focus}
              setFocus={setFocus}
              mode={mode}
            />
            <MarketsTable
              stocks={stocks}
              focus={focus}
              setFocus={setFocus}
              sortBy={sortBy}
              setSortBy={setSortBy}
              sortDir={sortDir}
              setSortDir={setSortDir}
              mode={mode}
              derivedBorrowApr={derivedBorrowApr}
              derivedVaultApr={derivedVaultApr}
            />
          </div>
          <AssetDeepDive
            stock={focused}
            derivedBorrowApr={derivedBorrowApr}
            derivedVaultApr={derivedVaultApr}
          />
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   KPI CELL
   ────────────────────────────────────────────────────────── */
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
        padding: "16px 22px",
        borderRight: last ? "none" : "1px solid var(--hairline-soft)",
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        {label}
      </div>
      <div
        className="font-serif font-medium tabular"
        style={{
          fontSize: 26,
          letterSpacing: "-0.025em",
          lineHeight: 1,
          color: color ?? "var(--ink)",
        }}
      >
        {value}
      </div>
      <div
        className="font-mono tabular text-ink-mute"
        style={{ fontSize: 10, marginTop: 6 }}
      >
        {sub}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   TERRAIN
   ────────────────────────────────────────────────────────── */
function Terrain({
  stocks,
  focus,
  setFocus,
  mode,
}: {
  stocks: Stock[];
  focus: string;
  setFocus: (s: string) => void;
  mode: Mode;
}) {
  // Live on-chain inputs: prices from Pyth adapters, LTV caps from vault.assets().
  // Falls back to STOCKS catalogue for assets without an on-chain token.
  const livePrices = useStockPrices();
  const assetConfigs = useAssetConfigsMap();

  const sorted = useMemo(
    () => [...stocks].sort((a, b) => a.sym.localeCompare(b.sym)),
    [stocks],
  );
  const W = 1280,
    H = 280,
    BASE = H - 36;

  // Vault/borrow APR now come from the protocol-wide derived IRM rate.
  // Max LTV reads from vault.assets(token).ltvBps so it always matches contract.
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  const derivedBorrowApr =
    stats.derived ? stats.derived.borrowAprBps / 100 : null;
  const derivedVaultApr =
    stats.derived ? stats.derived.supplyAprBps / 100 : null;

  const metric = (s: Stock) => {
    if (mode === "vault") return derivedVaultApr ?? 0;
    if (mode === "borrow") return derivedBorrowApr ?? 0;
    const cfg = assetConfigs.get(s.sym);
    const ltvBps = cfg?.ltvBps ?? s.ltv * 10_000;
    return (ltvBps / 1000); // scale into ~5–9 range to match APR axis
  };
  const metricMax = Math.max(...stocks.map(metric)) * 1.18;
  const heightFor = (s: Stock) => (metric(s) / metricMax) * (BASE - 30);

  const slice = W / sorted.length;
  const pts: [number, number][] = [];
  pts.push([0, BASE]);
  sorted.forEach((s, i) => {
    const cx = slice * i + slice / 2;
    const peakY = BASE - heightFor(s);
    pts.push([cx - slice * 0.35, BASE - heightFor(s) * 0.25]);
    pts.push([cx, peakY]);
    pts.push([cx + slice * 0.35, BASE - heightFor(s) * 0.25]);
  });
  pts.push([W, BASE]);
  let pathD = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const mx = (x + nx) / 2,
      my = (y + ny) / 2;
    pathD += ` Q ${x},${y} ${mx},${my}`;
  }
  pathD += ` L ${pts[pts.length - 1][0]},${pts[pts.length - 1][1]} Z`;

  return (
    <section
      className="bg-paper border-b border-hairline-soft"
      style={{ padding: "24px 32px 28px" }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="block overflow-visible"
      >
        <defs>
          <linearGradient id="ef-terr2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ink)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--ink)" stopOpacity="0.02" />
          </linearGradient>
          <pattern
            id="ef-hatch2"
            patternUnits="userSpaceOnUse"
            width="4"
            height="4"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="4"
              stroke="var(--ink)"
              strokeWidth="0.4"
            />
          </pattern>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = BASE - (BASE - 30) * f;
          return (
            <g key={f}>
              <line
                x1="0"
                x2={W}
                y1={y}
                y2={y}
                stroke="var(--hairline-soft)"
                strokeDasharray="2 4"
                strokeWidth="1"
              />
              <text
                x="0"
                y={y - 4}
                fontSize="10"
                fill="var(--ink-mute)"
                fontFamily="JetBrains Mono"
              >
                {(metricMax * f).toFixed(1)}
                {mode === "ltv" ? "0%" : "%"}
              </text>
            </g>
          );
        })}

        <rect
          x="0"
          y={BASE - (BASE - 30) * 0.92}
          width={W}
          height={(BASE - 30) * 0.08}
          fill="url(#ef-hatch2)"
          opacity="0.45"
        />
        <text
          x={W - 4}
          y={BASE - (BASE - 30) * 0.94}
          fontSize="9"
          fill="var(--down)"
          textAnchor="end"
          fontFamily="JetBrains Mono"
          letterSpacing="0.04em"
        >
          ELEVATED — HIGHER VOLATILITY
        </text>

        <path
          d={pathD}
          fill="url(#ef-terr2)"
          stroke="var(--ink)"
          strokeWidth="1.4"
        />
        <line
          x1="0"
          x2={W}
          y1={BASE}
          y2={BASE}
          stroke="var(--ink)"
          strokeWidth="1"
        />

        {sorted.map((s, i) => {
          const cx = slice * i + slice / 2;
          const peakY = BASE - heightFor(s);
          const isFocus = s.sym === focus;
          const lp = livePrices[s.sym];
          const up = lp?.isLive ? lp.price >= s.price : true;
          return (
            <g
              key={s.sym}
              style={{ cursor: "pointer" }}
              onClick={() => setFocus(s.sym)}
            >
              <line
                x1={cx}
                x2={cx}
                y1={peakY}
                y2={BASE}
                stroke={isFocus ? "var(--ink)" : "var(--hairline)"}
                strokeWidth={isFocus ? 1.2 : 0.8}
                strokeDasharray={isFocus ? "0" : "2 3"}
              />
              <circle
                cx={cx}
                cy={peakY}
                r={isFocus ? 6 : 4}
                fill={isFocus ? "var(--ink)" : "var(--paper)"}
                stroke="var(--ink)"
                strokeWidth="1.4"
              />
              {isFocus && (
                <circle
                  cx={cx}
                  cy={peakY}
                  r="6"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="1"
                  style={{
                    animation: "ef-pulse 1.8s ease-out infinite",
                    transformOrigin: `${cx}px ${peakY}px`,
                  }}
                />
              )}
              <text
                x={cx}
                y={peakY - 14}
                fontSize={isFocus ? 14 : 11}
                fill="var(--ink)"
                fontFamily="Source Serif 4"
                fontWeight={isFocus ? 600 : 500}
                textAnchor="middle"
                letterSpacing="-0.02em"
              >
                {mode === "ltv"
                  ? ((assetConfigs.get(s.sym)?.ltvBps ?? s.ltv * 10_000) / 100).toFixed(0) + "%"
                  : metric(s).toFixed(2) + "%"}
              </text>
              <text
                x={cx}
                y={BASE + 16}
                fontSize="11"
                fill={isFocus ? "var(--ink)" : "var(--ink-soft)"}
                fontFamily="JetBrains Mono"
                fontWeight={isFocus ? 600 : 500}
                textAnchor="middle"
              >
                {s.sym}
              </text>
              {(() => {
                const lp = livePrices[s.sym];
                const showLivePrice = lp?.isLive;
                return (
                  <text
                    x={cx}
                    y={BASE + 28}
                    fontSize="9"
                    fill={
                      showLivePrice
                        ? "var(--ink-soft)"
                        : up
                          ? "var(--up)"
                          : "var(--down)"
                    }
                    fontFamily="JetBrains Mono"
                    textAnchor="middle"
                  >
                    {showLivePrice
                      ? "$" + lp.price.toFixed(2)
                      : "—"}
                  </text>
                );
              })()}
            </g>
          );
        })}
      </svg>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────
   MARKETS TABLE (left, sortable)
   ────────────────────────────────────────────────────────── */
function MarketsTable({
  stocks,
  focus,
  setFocus,
  sortBy,
  setSortBy,
  sortDir,
  setSortDir,
  mode,
  derivedBorrowApr,
  derivedVaultApr,
}: {
  stocks: Stock[];
  focus: string;
  setFocus: (s: string) => void;
  sortBy: SortKey;
  setSortBy: (k: SortKey) => void;
  sortDir: SortDir;
  setSortDir: (d: SortDir | ((d: SortDir) => SortDir)) => void;
  mode: Mode;
  /// Protocol-wide derived rates (null while loading). Single value applied
  /// uniformly to every row — single-pool architecture.
  derivedBorrowApr: number | null;
  derivedVaultApr: number | null;
}) {
  const sorted = useMemo(() => {
    const copy = [...stocks];
    copy.sort((a, b) => {
      const av = a[sortBy] as number | string;
      const bv = b[sortBy] as number | string;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [stocks, sortBy, sortDir]);

  const onSort = (key: SortKey) => {
    if (key === sortBy) {
      setSortDir((d: SortDir) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const Header = ({
    children,
    k,
    right,
  }: {
    children: React.ReactNode;
    k: SortKey;
    right?: boolean;
  }) => (
    <th
      onClick={() => onSort(k)}
      className="cursor-pointer select-none uppercase font-medium text-ink-mute"
      style={{
        padding: "10px 14px",
        textAlign: right ? "right" : "left",
        fontSize: 10,
        letterSpacing: "0.12em",
        whiteSpace: "nowrap",
      }}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span
          style={{
            fontSize: 8,
            color: sortBy === k ? "var(--ink)" : "var(--hairline)",
          }}
        >
          {sortBy === k ? (sortDir === "asc" ? "▲" : "▼") : "◇"}
        </span>
      </span>
    </th>
  );

  return (
    <div className="overflow-auto">
      <div
        className="flex justify-between items-baseline border-b border-hairline-soft"
        style={{ padding: "16px 24px" }}
      >
        <div>
          <div className="eyebrow mb-1">Markets · click to focus</div>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
          >
            All {stocks.length} markets
          </h2>
        </div>
        <span
          className="font-mono text-ink-mute"
          style={{ fontSize: 10 }}
        >
          sorted by {sortBy} · {sortDir}
        </span>
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
        }}
      >
        <thead>
          <tr style={{ borderBottom: "1px solid var(--ink)" }}>
            <Header k="sym">Asset</Header>
            <Header k="price" right>
              Price
            </Header>
            <Header k="price" right>
              24h
            </Header>
            <Header k="ltv" right>
              Max LTV
            </Header>
            <Header k="price" right>
              Borrow
            </Header>
            <Header k="price" right>
              Vault
            </Header>
            <Header k="price" right>
              Liquidity
            </Header>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <MarketRow
              key={s.sym}
              stock={s}
              focused={s.sym === focus}
              onClick={() => setFocus(s.sym)}
              mode={mode}
              derivedBorrowApr={derivedBorrowApr}
              derivedVaultApr={derivedVaultApr}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarketRow({
  stock: s,
  focused,
  onClick,
  mode,
  derivedBorrowApr,
  derivedVaultApr,
}: {
  stock: Stock;
  focused: boolean;
  onClick: () => void;
  mode: Mode;
  derivedBorrowApr: number | null;
  derivedVaultApr: number | null;
}) {
  const adapterTick = useLiveAdapterTick(s.sym, (v) => fmt.usd(v));
  const simTick = useLiveTick(s.price, s.volatility, (v) => fmt.usd(v));
  const live = adapterTick.isLive ? adapterTick : simTick;

  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  const utilizationPct = stats.utilizationPct ?? 0;
  const liquidityDisplay =
    stats.liquidityUsd != null ? Number(stats.liquidityUsd) / 1e18 : 0;

  return (
    <tr
      onClick={onClick}
      className="cursor-pointer transition-colors"
      style={{
        borderBottom: "1px solid var(--hairline-soft)",
        background: focused ? "var(--paper-alt)" : "transparent",
      }}
    >
      <td style={{ padding: "14px 14px" }}>
        <div className="flex items-center gap-3">
          <div
            className="border border-ink bg-paper rounded-[2px] flex items-center justify-center"
            style={{ width: 30, height: 30 }}
          >
            <AssetLogo sym={s.sym} size={20} />
          </div>
          <div>
            <div className="font-mono font-semibold" style={{ fontSize: 12 }}>
              {s.sym}
            </div>
            <div
              className="text-ink-mute"
              style={{ fontSize: 10, marginTop: 2 }}
            >
              {s.sector}
            </div>
          </div>
        </div>
      </td>
      <td style={{ padding: "14px 14px", textAlign: "right" }}>
        <span
          className={`font-mono tabular font-medium inline-block rounded-[2px] ${
            live.dir > 0
              ? "animate-tick-up"
              : live.dir < 0
                ? "animate-tick-down"
                : ""
          }`}
          style={{
            fontSize: 13,
            padding: "2px 4px",
            marginRight: -4,
          }}
        >
          {live.formatted}
        </span>
      </td>
      <td style={{ padding: "14px 14px", textAlign: "right" }}>
        <span
          className="font-mono tabular font-medium text-ink-mute"
          style={{ fontSize: 12 }}
        >
          —
        </span>
      </td>
      <td style={{ padding: "14px 14px", textAlign: "right" }}>
        <div className="font-mono tabular font-medium" style={{ fontSize: 12 }}>
          {(s.ltv * 100).toFixed(0)}%
        </div>
        <div
          style={{
            height: 2,
            background: "var(--hairline-soft)",
            marginTop: 4,
          }}
        >
          <div
            style={{
              width: `${s.ltv * 100}%`,
              height: "100%",
              background: mode === "ltv" ? "var(--ink)" : "var(--ink-mute)",
            }}
          />
        </div>
      </td>
      <td
        style={{ padding: "14px 14px", textAlign: "right" }}
        title={
          derivedBorrowApr != null
            ? "Protocol-wide borrow rate (on-chain · single USDG pool)"
            : "Reference rate — utilization not yet loaded"
        }
      >
        <span
          className="font-mono tabular"
          style={{
            fontSize: 12,
            fontWeight: mode === "borrow" ? 600 : 500,
          }}
        >
          {(derivedBorrowApr ?? 0).toFixed(2)}%
        </span>
      </td>
      <td
        style={{ padding: "14px 14px", textAlign: "right" }}
        title={
          derivedVaultApr != null
            ? "LP yield = borrow × utilization × (1 − reserve factor)"
            : "Reference vault APR — utilization not yet loaded"
        }
      >
        <span
          className="font-mono tabular text-up"
          style={{
            fontSize: 12,
            fontWeight: mode === "vault" ? 600 : 500,
          }}
        >
          +{(derivedVaultApr ?? 0).toFixed(2)}%
        </span>
      </td>
      <td style={{ padding: "14px 14px", textAlign: "right" }}>
        <div className="font-mono tabular font-medium" style={{ fontSize: 12 }}>
          ${fmt.abbr(liquidityDisplay)}
        </div>
        <div
          className="text-ink-mute"
          style={{ fontSize: 10, marginTop: 2 }}
        >
          {utilizationPct.toFixed(0)}% util
        </div>
      </td>
    </tr>
  );
}

/* ──────────────────────────────────────────────────────────────
   ASSET DEEP DIVE (sticky right column)
   ────────────────────────────────────────────────────────── */
function AssetDeepDive({
  stock: s,
  derivedBorrowApr,
  derivedVaultApr,
}: {
  stock: Stock;
  derivedBorrowApr: number | null;
  derivedVaultApr: number | null;
}) {
  const adapterTick = useLiveAdapterTick(s.sym, (v) => fmt.usd(v));
  const simTick = useLiveTick(s.price, s.volatility, (v) => fmt.usd(v));
  const live = adapterTick.isLive ? adapterTick : simTick;
  const liqLtv = s.ltv * 100 + 8;
  const addr = stockAddress(s.sym);
  const effectiveBorrowApr = derivedBorrowApr ?? 0;
  const effectiveVaultApr = derivedVaultApr ?? 0;
  const ltvRecommendation = useRecommendedLtv(s.sym);

  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  const utilizationPct = stats.utilizationPct ?? 0;
  const liquidityDisplay =
    stats.liquidityUsd != null ? Number(stats.liquidityUsd) / 1e18 : 0;

  const [calcShares, setCalcShares] = useState(100);
  const calcUsd = s.price * calcShares;
  const maxBorrow = calcUsd * s.ltv;
  const yearlyYield =
    (maxBorrow * (effectiveVaultApr - effectiveBorrowApr)) / 100;

  // 30-day APY history (synthetic, anchored on the LIVE derived rate so the
  // chart converges to whatever the IRM is producing right now).
  const W = 340,
    H = 80;
  const hist = useMemo(() => {
    const out: number[] = [];
    let v = effectiveVaultApr - 0.4;
    let seed = s.sym.charCodeAt(0) * 13 + 7;
    for (let i = 0; i < 30; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const r = seed / 233280 - 0.5;
      v = v + r * 0.4 + (effectiveVaultApr - v) * 0.12;
      out.push(Math.max(0, v));
    }
    out[out.length - 1] = effectiveVaultApr;
    return out;
  }, [s.sym, effectiveVaultApr]);
  const minV = Math.min(...hist) * 0.95;
  const maxV = Math.max(...hist) * 1.05;
  const y = (v: number) =>
    H - ((v - minV) / (maxV - minV)) * (H - 16) - 8;
  const path = hist
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"} ${(i / (hist.length - 1)) * W},${y(v).toFixed(
          1,
        )}`,
    )
    .join(" ");
  const area = path + ` L ${W},${H} L 0,${H} Z`;

  return (
    <aside className="bg-paper flex flex-col overflow-auto">
      {/* Asset header */}
      <div
        className="border-b border-ink"
        style={{ padding: "20px 22px 16px" }}
      >
        <div className="eyebrow mb-2">Focused asset</div>
        <div className="flex items-baseline justify-between">
          <Link
            href={`/markets/${s.sym}`}
            className="flex items-center gap-2.5 no-underline text-ink hover:opacity-80 transition-opacity"
            title={`Open full detail for ${s.sym}`}
          >
            <span
              className="inline-flex items-center justify-center border border-ink bg-paper rounded-[2px]"
              style={{ width: 32, height: 32 }}
            >
              <AssetLogo sym={s.sym} size={22} />
            </span>
            <div
              className="font-serif font-medium"
              style={{ fontSize: 32, letterSpacing: "-0.03em", lineHeight: 1 }}
            >
              {s.sym}
            </div>
          </Link>
          {addr ? (
            <a
              href={explorerAddr(addr)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono tabular text-ink-mute no-underline hover:text-ink"
              style={{ fontSize: 10 }}
            >
              {shortAddr(addr)}
            </a>
          ) : (
            <span
              className="font-mono tabular text-ink-mute"
              style={{ fontSize: 10 }}
            >
              {isLive(s.sym) ? "unconfigured" : "off-chain"}
            </span>
          )}
        </div>
        <div className="text-ink-soft" style={{ fontSize: 13, marginTop: 4 }}>
          {s.name}
        </div>
        <Link
          href={`/markets/${s.sym}`}
          className="inline-flex items-center gap-1 mt-2.5 no-underline text-ink-soft hover:text-ink border-b border-hairline hover:border-ink transition-colors"
          style={{ fontSize: 11, letterSpacing: "0.02em", paddingBottom: 1 }}
        >
          Open full detail page →
        </Link>
      </div>

      {/* Live price */}
      <div
        className="border-b border-hairline-soft"
        style={{ padding: "16px 22px" }}
      >
        <div className="flex justify-between items-baseline">
          <div
            className={`font-serif font-medium tabular -ml-1 px-1 rounded-[2px] ${
              live.dir > 0
                ? "animate-tick-up"
                : live.dir < 0
                  ? "animate-tick-down"
                  : ""
            }`}
            style={{ fontSize: 28, letterSpacing: "-0.025em" }}
          >
            {live.formatted}
          </div>
          <div className="text-right">
            <div
              className="font-mono tabular font-medium text-ink-mute"
              style={{ fontSize: 12 }}
            >
              —
            </div>
            <div
              className="font-mono tabular text-ink-mute"
              style={{ fontSize: 11 }}
            >
              —
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8 }} className="flex items-center gap-2">
          <OraclePing
            color={adapterTick.isLive ? "var(--up)" : "var(--ink-mute)"}
            size={5}
            label={adapterTick.isLive ? "Pyth · on-chain" : "Off-chain · sim"}
          />
          {adapterTick.isLive && (
            <SessionBadge symbol={s.sym} variant="full" size={9} />
          )}
        </div>
      </div>

      {/* Vault APR history */}
      <div
        className="border-b border-hairline-soft"
        style={{ padding: "16px 22px" }}
      >
        <div className="flex justify-between items-baseline" style={{ marginBottom: 8 }}>
          <div className="eyebrow">Vault APR · last 30 days</div>
          <div
            className="font-serif font-medium tabular text-up"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
            title={
              derivedVaultApr != null
                ? "Live LP yield · derived from on-chain utilization"
                : "Reference vault APR — utilization not yet loaded"
            }
          >
            +{effectiveVaultApr.toFixed(2)}%
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block">
          <path d={area} fill="var(--up)" opacity="0.08" />
          <path d={path} stroke="var(--up)" strokeWidth="1.4" fill="none" />
          <line
            x1="0"
            x2={W}
            y1={y(effectiveVaultApr)}
            y2={y(effectiveVaultApr)}
            stroke="var(--up)"
            strokeWidth="0.6"
            strokeDasharray="2 3"
            opacity="0.5"
          />
          <circle cx={W} cy={y(effectiveVaultApr)} r="3" fill="var(--up)" />
        </svg>
        <div
          className="flex justify-between"
          style={{ marginTop: 6 }}
        >
          <span
            className="font-mono text-ink-mute"
            style={{ fontSize: 10 }}
          >
            min {Math.min(...hist).toFixed(2)}%
          </span>
          <span
            className="font-mono text-ink-mute"
            style={{ fontSize: 10 }}
          >
            max {Math.max(...hist).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Risk parameters */}
      <div
        className="border-b border-hairline-soft"
        style={{ padding: "14px 22px" }}
      >
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Risk parameters
        </div>
        {(
          [
            ["Max LTV", (s.ltv * 100).toFixed(0) + "%"],
            ["Liquidation LTV", liqLtv.toFixed(0) + "%"],
            ["Liquidation penalty", "5.00%"],
            ["Borrow APR · protocol", effectiveBorrowApr.toFixed(2) + "%"],
            ["Vault APR · protocol", "+" + effectiveVaultApr.toFixed(2) + "%"],
            [
              "Spread (you keep)",
              "+" + (effectiveVaultApr - effectiveBorrowApr).toFixed(2) + "%",
            ],
            ["Liquidity", "$" + fmt.abbr(liquidityDisplay)],
            [
              "Utilization",
              utilizationPct.toFixed(1) + "%",
            ],
            ["Volatility (σ 30d)", (s.volatility * 100).toFixed(0) + " bps"],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between items-center"
            style={{
              padding: "7px 0",
              borderBottom: "1px dashed var(--hairline-soft)",
            }}
          >
            <span
              className="font-mono text-ink-mute uppercase"
              style={{ fontSize: 10, letterSpacing: "0.04em" }}
            >
              {k}
            </span>
            <span
              className="font-mono tabular font-medium"
              style={{ fontSize: 12 }}
            >
              {v}
            </span>
          </div>
        ))}
        <div style={{ padding: "4px 0 0" }}>
          <LtvBreakdown recommendation={ltvRecommendation} />
        </div>
      </div>

      {/* Pledge calculator */}
      <div className="bg-paper-alt" style={{ padding: "14px 22px" }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          If you pledge…
        </div>
        <div
          className="bg-paper rounded-[2px] flex items-center gap-2"
          style={{
            padding: "10px 12px",
            border: "1px solid var(--ink)",
            marginBottom: 12,
          }}
        >
          <input
            type="number"
            value={calcShares}
            onChange={(e) =>
              setCalcShares(Math.max(0, +e.target.value || 0))
            }
            className="font-serif font-medium tabular bg-transparent border-0 outline-none flex-1 w-full min-w-0"
            style={{
              fontSize: 20,
              letterSpacing: "-0.02em",
            }}
          />
          <span className="font-mono text-ink-soft" style={{ fontSize: 12 }}>
            {s.sym}
          </span>
        </div>
        <div className="flex justify-between" style={{ padding: "6px 0" }}>
          <span className="text-ink-soft" style={{ fontSize: 11 }}>
            Collateral value
          </span>
          <span
            className="font-mono tabular font-medium"
            style={{ fontSize: 12 }}
          >
            {fmt.usd(calcUsd, 0)}
          </span>
        </div>
        <div className="flex justify-between" style={{ padding: "6px 0" }}>
          <span className="text-ink-soft" style={{ fontSize: 11 }}>
            Max borrow (USDG)
          </span>
          <span
            className="font-serif tabular font-medium"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
          >
            {fmt.usd(maxBorrow, 0)}
          </span>
        </div>
        <div className="flex justify-between" style={{ padding: "6px 0" }}>
          <span className="text-ink-soft" style={{ fontSize: 11 }}>
            Net yield · vaulted
          </span>
          <span
            className="font-mono tabular font-medium text-up"
            style={{ fontSize: 13 }}
          >
            +{fmt.usd(yearlyYield, 0)} / yr
          </span>
        </div>
        <Link
          href={`/pledge?sym=${s.sym}`}
          className="rounded-[2px] flex justify-between items-center bg-ink text-paper no-underline font-medium"
          style={{
            marginTop: 12,
            padding: "12px 16px",
            width: "100%",
            fontSize: 13,
          }}
        >
          <span>Pledge {s.sym} · 1-click bundle</span>
          <span className="font-mono opacity-70" style={{ fontSize: 10 }}>
            ERC-4337
          </span>
        </Link>
        <div
          className="text-center text-ink-mute"
          style={{ fontSize: 10, marginTop: 8 }}
        >
          ⛽ Gas sponsored by EquiFlow · You sign once
        </div>
      </div>
    </aside>
  );
}
