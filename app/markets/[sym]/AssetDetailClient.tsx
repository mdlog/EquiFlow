"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";
import { OraclePing } from "@/components/OraclePing";
import { SessionBadge } from "@/components/SessionBadge";
import { AssetLogo } from "@/components/AssetLogo";
import { AssetPriceChart } from "@/components/AssetPriceChart";
import { AssetActivityFeed } from "@/components/AssetActivityFeed";
import { Sparkline } from "@/components/Sparkline";
import { StockBalanceCell } from "@/components/StockBalanceCell";
import { LtvBreakdown } from "@/components/LtvBreakdown";
import { findStock, stockAddress, isLive } from "@/lib/config/stocks";
import { fmt } from "@/lib/format";
import { useLiveAdapterTick, useStockPrice } from "@/lib/hooks/use-adapter-price";
import { useLiveTick } from "@/lib/hooks/use-live-tick";
import { useRecommendedLtv } from "@/lib/hooks/use-recommended-ltv";
import {
  useMarkets24h,
  useMarketsSparkline,
} from "@/lib/hooks/use-market-history";
import { useListedAssets, useProtocolStats } from "@/lib/hooks/use-protocol-stats";
import { formatUnits } from "viem";
import { shortAddr, explorerAddr } from "@/lib/contracts";

interface Props {
  sym: string;
}

/// Full asset detail surface. Composed of:
///   1. Breadcrumb back-link to /markets
///   2. Hero — logo, symbol, name, address, live price + 24h pill, session
///   3. KPI strip — LTV / borrow APR / vault APR / liquidity / utilization
///   4. AssetPriceChart (real Pyth Benchmarks bars, 1D/7D/30D toggle)
///   5. 2-col grid: risk parameters + pledge calculator
///   6. Footer CTA: pledge button (anchor down to /pledge?sym=)
export function AssetDetailClient({ sym }: Props) {
  const stock = findStock(sym);
  const addr = stockAddress(sym);
  const { isConnected } = useAccount();

  /// Live price: on-chain (Pyth adapter cache) if the token is wired;
  /// otherwise a deterministic client-side walk anchored on the static price.
  const adapterTick = useLiveAdapterTick(stock.sym, (v) => fmt.usd(v));
  const simTick = useLiveTick(stock.price, stock.volatility, (v) => fmt.usd(v));
  const live = adapterTick.isLive ? adapterTick : simTick;
  const { ltv: liveLtv, ltvIsLive } = useStockPrice(stock.sym);
  const ltvRecommendation = useRecommendedLtv(sym);

  /// 24h change + sparkline — same backends the /markets table uses.
  const history24h = useMarkets24h([sym]);
  const sparkline = useMarketsSparkline([sym], 48);
  const dataChange = history24h.data?.[sym]?.changePct ?? null;
  const sparkData = sparkline.data?.series?.[sym];
  const sparkEnabled = sparkline.data?.enabled ?? false;
  const effectiveChangePct = dataChange ?? 0;
  const up = effectiveChangePct >= 0;

  /// Protocol-wide derived rates from on-chain. All assets share the same
  /// borrow/supply rate because the vault is single-pool USDG.
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  const derivedBorrowApr =
    stats.derived ? stats.derived.borrowAprBps / 100 : 0;
  const derivedVaultApr =
    stats.derived ? stats.derived.supplyAprBps / 100 : 0;
  const derivedUtilPct = stats.utilizationPct;
  const vaultLiquidity =
    stats.liquidityUsd != null ? Number(formatUnits(stats.liquidityUsd, 18)) : 0;

  /// Pledge calculator — uses the LIVE rates (derived) for the yield estimate,
  /// so the math reflects what the user will actually earn at current util.
  const [calcShares, setCalcShares] = useState(0);
  const effectiveLtv = liveLtv ?? stock.ltv;
  const calcUsd = live.value * calcShares;
  const maxBorrow = calcUsd * effectiveLtv;
  const yearlySpread =
    (maxBorrow * (derivedVaultApr - derivedBorrowApr)) / 100;
  const liqLtv = effectiveLtv * 100 + 8;

  /// Risk + KPI rows — derived once so the JSX stays declarative.
  const riskRows = useMemo<Array<[string, string]>>(
    () => [
      ["Max LTV", (effectiveLtv * 100).toFixed(0) + "%"],
      ["Liquidation LTV", liqLtv.toFixed(0) + "%"],
      ["Liquidation penalty", stats.liquidationBonusBps != null
        ? (stats.liquidationBonusBps / 100).toFixed(2) + "%" : "5.00%"],

      ["Borrow APR (protocol)", derivedBorrowApr.toFixed(2) + "%"],
      ["Vault APR (protocol)", fmt.signedPct(derivedVaultApr, 2)],
      [
        "Spread (you keep)",
        fmt.signedPct(derivedVaultApr - derivedBorrowApr, 2),
      ],
      [
        "Utilization (USDG pool)",
        derivedUtilPct != null
          ? derivedUtilPct.toFixed(1) + "%"
          : "loading…",
      ],
      ["Liquidity", "$" + fmt.abbr(vaultLiquidity)],
      [
        "Volatility (σ 30d)",
        (stock.volatility * 100).toFixed(0) + " bps",
      ],
      [
        "LTV source",
        ltvIsLive ? "on-chain · vault.assets()" : "reference · static",
      ],
      ["Rate source", "on-chain · derived from utilization"],
    ],
    [
      effectiveLtv,
      liqLtv,
      derivedBorrowApr,
      derivedVaultApr,
      derivedUtilPct,
      vaultLiquidity,
      stock.volatility,
      ltvIsLive,
    ],
  );

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav current="markets" />

      {/* Breadcrumb */}
      <div className="border-b border-hairline-soft bg-paper-alt/40">
        <div
          className="max-w-[1320px] mx-auto px-4 sm:px-8 flex items-center justify-between gap-2 py-2"
          style={{ fontSize: 11 }}
        >
          <div className="flex items-center gap-2">
            <Link
              href="/markets"
              className="text-ink-soft no-underline hover:text-ink"
            >
              Markets
            </Link>
            <span className="text-ink-mute">·</span>
            <span className="font-mono uppercase" style={{ letterSpacing: "0.06em" }}>
              {stock.sym}
            </span>
          </div>
          <Link
            href="/markets"
            className="font-mono uppercase inline-flex items-center gap-1.5 text-ink-soft border border-hairline rounded-[2px] px-2.5 py-1 no-underline hover:border-ink hover:text-ink"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            <span aria-hidden>←</span>
            Back to Markets
          </Link>
        </div>
      </div>

      {/* Hero */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6 sm:py-8 grid grid-cols-12 gap-4 sm:gap-8 items-end">
          <div className="col-span-12 md:col-span-7 flex items-center gap-5">
            <div
              className="inline-flex items-center justify-center border border-ink bg-paper rounded-[2px]"
              style={{ width: 56, height: 56 }}
            >
              <AssetLogo sym={stock.sym} size={36} />
            </div>
            <div>
              <div className="eyebrow mb-1">
                {stock.sector} · {isLive(stock.sym) ? "Live on RBN" : "Reference asset"}
              </div>
              <div
                className="font-serif font-medium"
                style={{ fontSize: "clamp(36px, 5vw, 56px)", letterSpacing: "-0.035em", lineHeight: 1 }}
              >
                {stock.sym}
              </div>
              <div
                className="text-ink-soft mt-1.5"
                style={{ fontSize: 16, letterSpacing: "-0.01em" }}
              >
                {stock.name}
              </div>
              {addr ? (
                <a
                  href={explorerAddr(addr)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono inline-flex items-center gap-1.5 text-ink-mute border border-hairline rounded-[2px] px-2 py-0.5 no-underline hover:border-ink hover:text-ink mt-3"
                  style={{ fontSize: 11 }}
                >
                  {shortAddr(addr)} ↗
                </a>
              ) : (
                <span
                  className="font-mono inline-block text-ink-mute border border-hairline-soft rounded-[2px] px-2 py-0.5 mt-3"
                  style={{ fontSize: 11 }}
                >
                  {isLive(stock.sym) ? "unconfigured" : "off-chain"}
                </span>
              )}
            </div>
          </div>

          {/* Price + 24h pill */}
          <div className="col-span-12 md:col-span-5 text-right">
            <div className="flex justify-end items-baseline gap-3">
              <div
                key={live.dir + "-" + live.value.toFixed(2)}
                className={`font-serif font-medium tabular inline-block px-1.5 -mr-1.5 rounded-[2px] ${
                  live.dir > 0
                    ? "animate-tick-up"
                    : live.dir < 0
                      ? "animate-tick-down"
                      : ""
                }`}
                style={{ fontSize: 56, letterSpacing: "-0.035em", lineHeight: 1 }}
              >
                {live.formatted}
              </div>
            </div>
            <div className="flex justify-end items-center gap-3 mt-2">
              <span
                className="font-mono tabular font-medium"
                style={{
                  fontSize: 14,
                  color: up ? "var(--up)" : "var(--down)",
                }}
                title={
                  dataChange != null
                    ? "Real 24h change · Pyth Benchmarks anchor"
                    : "Reference change · static fallback"
                }
              >
                {fmt.pct(effectiveChangePct, 2, true)} · 24h
              </span>
              {sparkData && sparkData.length >= 2 && (
                <Sparkline
                  data={sparkData}
                  w={120}
                  h={28}
                  color={up ? "var(--up)" : "var(--down)"}
                  fill
                />
              )}
            </div>
            <div className="mt-2 flex justify-end items-center gap-2">
              <OraclePing
                color={adapterTick.isLive ? "var(--up)" : "var(--ink-mute)"}
                size={5}
                label={adapterTick.isLive ? "Pyth · on-chain" : "Off-chain · sim"}
              />
              {adapterTick.isLive && (
                <SessionBadge symbol={stock.sym} variant="full" size={9} />
              )}
              {sparkEnabled && sparkData?.length ? (
                <span
                  className="font-mono uppercase text-ink-mute"
                  style={{ fontSize: 9, letterSpacing: "0.08em" }}
                >
                  · live 24h
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* KPI strip */}
      <section className="border-b border-hairline bg-paper-alt">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ["Max LTV", (effectiveLtv * 100).toFixed(0) + "%", ltvIsLive ? "on-chain" : "reference"],
              [
                "Borrow APR",
                derivedBorrowApr.toFixed(2) + "%",
                "on-chain · protocol",
              ],
              [
                "Vault APR",
                fmt.signedPct(derivedVaultApr, 2),
                "LP yield · protocol",
              ],
              [
                isConnected && addr ? "Your balance" : "Liquidity",
                "",
                isConnected && addr
                  ? "wallet · on-chain"
                  : (derivedUtilPct != null
                    ? derivedUtilPct.toFixed(0) + "% utilized"
                    : "—"),
              ],
              [
                "Volatility",
                (stock.volatility * 100).toFixed(0) + " bps",
                "σ · 30d",
              ],
            ] as [string, string, string][]
          ).map(([label, val, sub], i, arr) => (
            <div
              key={label}
              className={`px-5 py-3.5 ${i < arr.length - 1 ? "border-r border-hairline" : ""}`}
            >
              <div className="eyebrow mb-1.5">{label}</div>
              {val ? (
                <div
                  className="font-serif font-medium tabular"
                  style={{ fontSize: 22, letterSpacing: "-0.02em" }}
                >
                  {val}
                </div>
              ) : isConnected && addr ? (
                <StockBalanceCell sym={stock.sym} price={live.value} />
              ) : (
                <div
                  className="font-serif font-medium tabular"
                  style={{ fontSize: 22, letterSpacing: "-0.02em" }}
                >
                  ${fmt.abbr(vaultLiquidity)}
                </div>
              )}
              <div className="text-ink-mute mt-0.5" style={{ fontSize: 11 }}>
                {sub}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Price chart (real Pyth Benchmarks) */}
      <AssetPriceChart symbol={stock.sym} fallbackPrice={live.value} />

      {/* Risk + pledge calculator */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6 sm:py-8 grid grid-cols-12 gap-4 sm:gap-8">
          {/* Risk parameters */}
          <div className="col-span-12 md:col-span-6">
            <div className="eyebrow mb-3">Risk parameters</div>
            <div className="border border-hairline rounded-[2px] bg-paper">
              {riskRows.map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between items-center px-4 py-2.5 border-b border-hairline-soft last:border-b-0"
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
            </div>
            <LtvBreakdown recommendation={ltvRecommendation} />
          </div>

          {/* Pledge calculator */}
          <div className="col-span-12 md:col-span-6">
            <div className="eyebrow mb-3">If you pledge…</div>
            <div className="border border-hairline rounded-[2px] bg-paper-alt px-5 py-5">
              <div
                className="bg-paper rounded-[2px] flex items-center gap-2 mb-4"
                style={{
                  padding: "12px 14px",
                  border: "1px solid var(--ink)",
                }}
              >
                <input
                  type="number"
                  value={calcShares}
                  onChange={(e) =>
                    setCalcShares(Math.max(0, +e.target.value || 0))
                  }
                  className="font-serif font-medium tabular bg-transparent border-0 outline-none flex-1 w-full min-w-0"
                  style={{ fontSize: 22, letterSpacing: "-0.02em" }}
                />
                <span
                  className="font-mono text-ink-soft"
                  style={{ fontSize: 13 }}
                >
                  {stock.sym}
                </span>
              </div>
              {(
                [
                  ["Collateral value", fmt.usd(calcUsd, 0)],
                  ["Max borrow (USDG)", fmt.usd(maxBorrow, 0)],
                  [
                    "Net yield · vaulted",
                    (yearlySpread >= 0 ? "+" : "−") + fmt.usd(Math.abs(yearlySpread), 0) + " / yr",
                    "up",
                  ],
                ] as [string, string, "up" | undefined][]
              ).map(([k, v, tone]) => (
                <div
                  key={k}
                  className="flex justify-between items-baseline py-2"
                  style={{ borderBottom: "1px dashed var(--hairline-soft)" }}
                >
                  <span className="text-ink-soft" style={{ fontSize: 12 }}>
                    {k}
                  </span>
                  <span
                    className={`font-mono tabular font-medium ${
                      tone === "up" ? "text-up" : ""
                    }`}
                    style={{ fontSize: 13 }}
                  >
                    {v}
                  </span>
                </div>
              ))}
              <Link
                href={`/pledge?sym=${stock.sym}`}
                className="rounded-[2px] flex justify-between items-center bg-ink text-paper no-underline font-medium mt-5"
                style={{ padding: "14px 18px", fontSize: 14 }}
              >
                <span>Pledge {stock.sym} · 1-click bundle</span>
                <span
                  className="font-mono opacity-70"
                  style={{ fontSize: 11 }}
                >
                  ERC-4337 ↗
                </span>
              </Link>
              <div
                className="text-center text-ink-mute mt-2"
                style={{ fontSize: 10 }}
              >
                ⛽ Gas sponsored by EquiFlow · You sign once
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* On-chain activity (Pledged + Liquidated for this token) */}
      <AssetActivityFeed symbol={stock.sym} token={addr} />

      <SiteFooter />
    </div>
  );
}
