"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageNav } from "@/components/PageNav";
import { SectionHead } from "@/components/SectionHead";
import { SiteFooter } from "@/components/SiteFooter";
import { OraclePing } from "@/components/OraclePing";
import { Sparkline } from "@/components/Sparkline";
import { useAccount } from "wagmi";
import { STOCKS, type Stock, stockAddress } from "@/lib/config/stocks";
import { formatUnits } from "viem";
import { fmt } from "@/lib/format";
import { useLiveTick } from "@/lib/hooks/use-live-tick";
import { useLiveAdapterTick, useStockPrice } from "@/lib/hooks/use-adapter-price";
import {
  useListedAssets,
  useProtocolStats,
} from "@/lib/hooks/use-protocol-stats";
import {
  useMarkets24h,
  useMarketsSparkline,
} from "@/lib/hooks/use-market-history";
import { shortAddr, explorerAddr } from "@/lib/contracts";
import { StockBalanceCell } from "@/components/StockBalanceCell";
import { SessionBadge } from "@/components/SessionBadge";
import { AssetLogo } from "@/components/AssetLogo";

type Filter = "all" | "gainers" | "losers";

export default function MarketsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [hoverSym, setHoverSym] = useState<string | null>(null);
  const { isConnected } = useAccount();

  const listed = useListedAssets();
  const stats = useProtocolStats(listed);

  // History is queried for ALL known symbols up-front (not the filtered subset)
  // so flipping the filter doesn't re-trigger fetches. Keys are stable when the
  // STOCKS catalogue doesn't change between renders.
  const allSyms = useMemo(() => STOCKS.map((s) => s.sym), []);
  const history24h = useMarkets24h(allSyms);
  const sparkline = useMarketsSparkline(allSyms, 24);

  const stocks = useMemo(() => {
    // When real 24h data is available it should drive the gainers / losers
    // filter — otherwise the filter would silently use the static seed values.
    const pickChange = (sym: string, fallback: number): number =>
      history24h.data?.[sym]?.changePct ?? fallback;
    if (filter === "gainers")
      return STOCKS.filter((s) => pickChange(s.sym, 0) > 0);
    if (filter === "losers")
      return STOCKS.filter((s) => pickChange(s.sym, 0) < 0);
    return STOCKS;
  }, [filter, history24h.data]);

  // Format 1e18 USD bigint into abbreviated USD string ("$1.24M").
  const fmtUsd1e18 = (v: bigint | null): string =>
    v == null ? "—" : "$" + fmt.abbr(Number(v / 10n ** 12n) / 1e6);
  const kpis: Array<readonly [string, string, string]> = [
    [
      "Total Value Locked",
      fmtUsd1e18(stats.tvlUsd),
      stats.assetCount != null
        ? `across ${stats.assetCount} asset${stats.assetCount === 1 ? "" : "s"}`
        : "loading…",
    ],
    [
      "Stablecoins borrowed",
      fmtUsd1e18(stats.borrowedUsd),
      "USDG · on-chain",
    ],
    [
      "Vault utilization",
      stats.utilizationPct != null ? fmt.pct(stats.utilizationPct, 1) : "—",
      "borrowed / liquidity",
    ],
    [
      "Listed markets",
      stats.assetCount != null ? `${stats.assetCount}` : "—",
      "from vault.listedAssets()",
    ],
    [
      "Liquidations (24h)",
      stats.liquidations7d
        ? `${stats.liquidations7d.count}`
        : "—",
      stats.liquidations7d
        ? fmtUsd1e18(stats.liquidations7d.totalDebtUsd) + " total"
        : "indexer offline",
    ],
  ];

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav current="markets" />

      <div className="max-w-[1320px] w-full mx-auto px-8 pt-7 pb-4">
        <SectionHead
          kicker={`Markets · ${stats.assetCount ?? STOCKS.length} listed assets · Pyth Network oracles`}
          title="Pledge any holding. Borrow against it. Or let it earn."
          right={
            <div className="flex gap-1 p-[3px] border border-hairline rounded-[2px]">
              {(["all", "gainers", "losers"] as Filter[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className="border-0 px-3 py-1.5 capitalize rounded-[2px] transition-colors"
                  style={{
                    fontSize: 12,
                    background: filter === k ? "var(--ink)" : "transparent",
                    color: filter === k ? "var(--paper)" : "var(--ink-soft)",
                  }}
                >
                  {k}
                </button>
              ))}
            </div>
          }
        />
      </div>

      <section className="border-y border-hairline bg-paper-alt">
        <div className="max-w-[1320px] w-full mx-auto px-8 grid grid-cols-5">
          {kpis.map(([label, val, sub], i) => (
            <div
              key={label}
              className={`px-5 py-3.5 ${i < 4 ? "border-r border-hairline" : ""}`}
            >
              <div className="eyebrow mb-1.5">{label}</div>
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 22, letterSpacing: "-0.02em" }}
              >
                {val}
              </div>
              <div className="text-ink-mute mt-0.5" style={{ fontSize: 11 }}>
                {sub}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="max-w-[1320px] w-full mx-auto px-8 pt-5 flex-1 flex flex-col">
        {/* Column headers */}
        <div
          className="grid gap-4 py-2.5 border-b border-hairline text-ink-mute uppercase font-medium"
          style={{
            gridTemplateColumns: "1.8fr 1fr 0.85fr 0.8fr 0.9fr 1fr 1fr 100px",
            fontSize: 10,
            letterSpacing: "0.12em",
          }}
        >
          <div>Asset</div>
          <div className="text-right">Last · Oracle</div>
          <div className="text-right">24h</div>
          <div className="text-right">Max LTV</div>
          <div className="text-right">Borrow APR</div>
          <div className="text-right">Vault APR</div>
          <div className="text-right">
            {isConnected ? "Your balance" : "Liquidity"}
          </div>
          <div />
        </div>

        <div className="flex-1">
          {stocks.map((s, i) => (
            <LedgerRow
              key={s.sym}
              stock={s}
              index={i}
              hovered={hoverSym === s.sym}
              walletConnected={isConnected}
              onHover={() => setHoverSym(s.sym)}
              onLeave={() => setHoverSym(null)}
              live24hPct={history24h.data?.[s.sym]?.changePct ?? null}
              sparkData={sparkline.data?.series?.[s.sym]}
              sparkEnabled={sparkline.data?.enabled ?? false}
              derivedBorrowApr={
                stats.derived ? stats.derived.borrowAprBps / 100 : null
              }
              derivedVaultApr={
                stats.derived ? stats.derived.supplyAprBps / 100 : null
              }
              vaultLiquidityUsd={stats.liquidityUsd}
              vaultUtilizationPct={stats.utilizationPct}
            />
          ))}
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

function LedgerRow({
  stock,
  index,
  hovered,
  walletConnected,
  onHover,
  onLeave,
  live24hPct,
  sparkData,
  sparkEnabled,
  derivedBorrowApr,
  derivedVaultApr,
  vaultLiquidityUsd,
  vaultUtilizationPct,
}: {
  stock: Stock;
  index: number;
  hovered: boolean;
  walletConnected: boolean;
  onHover: () => void;
  onLeave: () => void;
  /// Real change% from Hermes 24h-ago anchor (null while loading / on weekend
  /// gaps when no historical print exists). Falls back to stock.changePct.
  live24hPct: number | null;
  /// Real sparkline points (last 24h, downsampled). Empty when Upstash is off
  /// or no keeper ticks have been recorded yet.
  sparkData?: number[];
  /// Whether the sparkline backend is wired (Upstash configured server-side).
  /// When false, we don't even hint at "real" data — the seeded curve renders.
  sparkEnabled: boolean;
  /// Borrow/supply APR read from vault.borrowApyBps() / vault.lpApyBps().
  /// Null while the first RPC round-trip hasn't resolved.
  derivedBorrowApr: number | null;
  derivedVaultApr: number | null;
  /// Vault-wide USDG liquidity in 1e18 USD units.
  vaultLiquidityUsd: bigint | null;
  /// Vault-wide utilization percentage.
  vaultUtilizationPct: number | null;
}) {
  const effectiveChangePct = live24hPct ?? 0;
  const up = effectiveChangePct >= 0;
  const isReal24h = live24hPct != null;
  const hasRealSpark = !!sparkData && sparkData.length >= 2;
  const breathePeriod = (3 + (1 - stock.volatility) * 5).toFixed(1);
  const addr = stockAddress(stock.sym);
  const onChain = !!addr;
  // On-chain price from PythPriceAdapter when token is wired; falls back to
  // a client-side random walk for reference (non-RBN) assets.
  const adapterTick = useLiveAdapterTick(stock.sym, (v) => fmt.usd(v));
  const simTick = useLiveTick(stock.price, stock.volatility, (v) => fmt.usd(v));
  const live = adapterTick.isLive ? adapterTick : simTick;
  // On-chain LTV from vault.assets(token).ltvBps when listed; falls back to
  // STOCKS.ltv for reference assets. wagmi dedupes the assets() read shared
  // with useLiveAdapterTick above.
  const { ltv: liveLtv, ltvIsLive } = useStockPrice(stock.sym);

  const router = useRouter();
  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={() => router.push(`/markets/${stock.sym}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/markets/${stock.sym}`);
        }
      }}
      className="grid gap-4 py-[18px] border-b border-hairline-soft items-center cursor-pointer relative transition-colors duration-150"
      style={{
        gridTemplateColumns: "1.8fr 1fr 0.85fr 0.8fr 0.9fr 1fr 1fr 100px",
        background: hovered ? "var(--paper-alt)" : "transparent",
      }}
    >
      {/* Asset cell */}
      <div className="flex items-center gap-3.5">
        <div
          className="w-11 h-11 border border-ink rounded-[2px] flex items-center justify-center bg-paper relative overflow-hidden"
        >
          <div
            className="absolute inset-0"
            style={{
              animation: `ef-breathe ${breathePeriod}s ease-in-out infinite`,
              background: `linear-gradient(to bottom, ${up ? "var(--up-soft)" : "var(--down-soft)"}, transparent 50%)`,
              opacity: 0.45,
            }}
          />
          <AssetLogo
            sym={stock.sym}
            size={26}
            className="relative"
          />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span
              className="font-mono font-semibold"
              style={{ fontSize: 14, letterSpacing: "0.01em" }}
            >
              {stock.sym}
            </span>
            {onChain ? (
              <a
                href={explorerAddr(addr!)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-ink-mute border border-hairline rounded-[2px] px-1.5 no-underline hover:border-ink hover:text-ink"
                style={{ fontSize: 10, paddingTop: 1, paddingBottom: 1 }}
                title="View on Robinhood Chain explorer"
              >
                {shortAddr(addr)}
              </a>
            ) : stock.liveOnRBN ? (
              <span
                className="font-mono text-amber border border-amber rounded-[2px] px-1.5"
                style={{ fontSize: 10, paddingTop: 1, paddingBottom: 1 }}
                title="Set NEXT_PUBLIC_TOKEN_* env to wire this token"
              >
                unconfigured
              </span>
            ) : (
              <span
                className="font-mono text-ink-mute border border-hairline-soft rounded-[2px] px-1.5"
                style={{ fontSize: 10, paddingTop: 1, paddingBottom: 1 }}
                title="Reference asset · not yet issued on Robinhood Chain testnet"
              >
                off-chain
              </span>
            )}
          </div>
          <div className="text-ink-soft mt-0.5" style={{ fontSize: 12 }}>
            {stock.name} · <span className="text-ink-mute">{stock.sector}</span>
          </div>
        </div>
      </div>

      {/* Live price */}
      <div className="text-right">
        <div
          key={live.dir + "-" + live.value.toFixed(2)}
          className={`font-serif font-medium tabular inline-block px-1.5 py-0.5 -mr-1.5 rounded-[2px] ${
            live.dir > 0
              ? "animate-tick-up"
              : live.dir < 0
                ? "animate-tick-down"
                : ""
          }`}
          style={{ fontSize: 18, letterSpacing: "-0.02em" }}
        >
          {live.formatted}
        </div>
        <div className="mt-0.5 flex justify-end gap-1.5 items-center">
          <OraclePing
            color={adapterTick.isLive ? "var(--up)" : "var(--ink-mute)"}
            size={5}
            label={null}
          />
          <span className="font-mono text-ink-mute" style={{ fontSize: 10 }}>
            {adapterTick.isLive ? "Pyth · on-chain" : "Off-chain · sim"}
          </span>
          {adapterTick.isLive && (
            <SessionBadge symbol={stock.sym} variant="dense" />
          )}
        </div>
      </div>

      {/* 24h change + sparkline */}
      <div className="text-right">
        <div
          className="font-mono tabular font-medium"
          style={{
            fontSize: 13,
            color: up ? "var(--up)" : "var(--down)",
          }}
          title={
            isReal24h
              ? "24h change from Pyth historical anchor (now vs t-86400s)"
              : "Reference change — Pyth has no historical print for this anchor"
          }
        >
          {fmt.pct(effectiveChangePct, 2, true)}
        </div>
        <div className="flex justify-end mt-0.5">
          <Sparkline
            data={hasRealSpark ? sparkData : undefined}
            w={70}
            h={18}
            color={up ? "var(--up)" : "var(--down)"}
            fill
          />
        </div>
        {(isReal24h || hasRealSpark) && (
          <div
            className="text-ink-mute mt-0.5"
            style={{ fontSize: 9, letterSpacing: "0.06em" }}
            title={
              hasRealSpark
                ? "Sparkline rendered from on-chain keeper ticks (last 24h)"
                : "24h change is real; sparkline is illustrative"
            }
          >
            {hasRealSpark ? "live · 24h" : sparkEnabled ? "live · 24h" : "24h"}
          </div>
        )}
      </div>

      {/* LTV bar */}
      <div className="text-right">
        <div
          className="font-mono tabular font-medium"
          style={{ fontSize: 13 }}
          title={
            ltvIsLive
              ? "Max LTV from vault.assets(token).ltvBps"
              : "Reference LTV — token not listed in vault"
          }
        >
          {(liveLtv * 100).toFixed(0)}%
        </div>
        <div className="h-[3px] bg-hairline-soft mt-1.5 relative">
          <div
            className="absolute left-0 top-0 bottom-0 bg-ink"
            style={{ width: `${liveLtv * 100}%` }}
          />
        </div>
      </div>

      {/* Borrow APR — vault.borrowApyBps() */}
      <div className="text-right">
        <div
          className="font-mono tabular font-medium"
          style={{ fontSize: 13 }}
          title={
            derivedBorrowApr != null
              ? "Derived from on-chain utilization via kinked two-slope IRM (Aave V3-style)"
              : "Reference borrow APR — utilization not yet loaded"
          }
        >
          {(derivedBorrowApr ?? 0).toFixed(2)}%
        </div>
        <div className="text-ink-mute mt-0.5" style={{ fontSize: 10 }}>
          vs USDG · protocol
        </div>
      </div>

      {/* Vault APR — derived: borrow × U × (1 − RF) */}
      <div className="text-right">
        <div
          className="font-mono tabular font-medium text-up"
          style={{ fontSize: 13 }}
          title={
            derivedVaultApr != null
              ? "Supply rate = Borrow × Utilization × (1 − ReserveFactor)"
              : "Reference vault APR — utilization not yet loaded"
          }
        >
          +{(derivedVaultApr ?? 0).toFixed(2)}%
        </div>
        <div className="text-ink-mute mt-0.5" style={{ fontSize: 10 }}>
          LP yield · protocol
        </div>
      </div>

      {/* Liquidity / Wallet balance */}
      <div className="text-right">
        {walletConnected && onChain ? (
          <StockBalanceCell sym={stock.sym} price={live.value} />
        ) : (
          <>
            <div className="font-mono tabular font-medium" style={{ fontSize: 13 }}>
              ${fmt.abbr(Number(formatUnits(vaultLiquidityUsd ?? 0n, 18)))}
            </div>
            <div className="text-ink-mute mt-0.5" style={{ fontSize: 10 }}>
              {vaultUtilizationPct != null ? vaultUtilizationPct.toFixed(0) + "%" : "—"} utilized
            </div>
          </>
        )}
      </div>

      {/* Pledge action */}
      <div className="text-right">
        <Link
          href={`/pledge?sym=${stock.sym}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-ink rounded-[2px] no-underline transition-all duration-150 font-medium"
          style={{
            fontSize: 12,
            background: hovered ? "var(--ink)" : "transparent",
            color: hovered ? "var(--paper)" : "var(--ink)",
          }}
        >
          Pledge
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2 5h6M5 2l3 3-3 3" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
