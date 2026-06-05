"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageNav } from "@/components/PageNav";
import { SectionHead } from "@/components/SectionHead";
import { SiteFooter } from "@/components/SiteFooter";
import { OraclePing } from "@/components/OraclePing";
import { Sparkline } from "@/components/Sparkline";
import { STOCKS, type Stock, stockAddress } from "@/lib/config/stocks";
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
import { SessionBadge } from "@/components/SessionBadge";
import { AssetLogo } from "@/components/AssetLogo";
import { PledgeSidebar } from "@/components/PledgeSidebar";

type Sector = "all" | "live" | "semis" | "tech" | "etf";
type SortKey = "sym" | "price" | "change" | "ltv" | "volatility";

const SECTORS: { id: Sector; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live on-chain" },
  { id: "semis", label: "Semis" },
  { id: "tech", label: "Tech" },
  { id: "etf", label: "ETF" },
];

function matchSector(s: Stock, sector: Sector): boolean {
  if (sector === "all") return true;
  if (sector === "live") return s.liveOnRBN && !!stockAddress(s.sym);
  if (sector === "semis") return s.sector.toLowerCase().includes("semi");
  if (sector === "tech")
    return (
      s.sector.toLowerCase().includes("tech") ||
      s.sector.toLowerCase().includes("cloud") ||
      s.sector.toLowerCase().includes("data") ||
      s.sector.toLowerCase().includes("ai") ||
      s.sector.toLowerCase().includes("streaming") ||
      s.sector.toLowerCase().includes("commerce")
    );
  if (sector === "etf") return s.sector.toLowerCase().includes("etf");
  return true;
}

export default function MarketsPage() {
  const [sector, setSector] = useState<Sector>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("sym");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hoverSym, setHoverSym] = useState<string | null>(null);
  const [pledgeSym, setPledgeSym] = useState<string | null>(null);

  const listed = useListedAssets();
  const stats = useProtocolStats(listed);

  // History is queried for ALL known symbols up-front (not the filtered subset)
  // so flipping the filter doesn't re-trigger fetches. Keys are stable when the
  // STOCKS catalogue doesn't change between renders.
  const allSyms = useMemo(() => STOCKS.map((s) => s.sym), []);
  const history24h = useMarkets24h(allSyms);
  const sparkline = useMarketsSparkline(allSyms, 48);

  const pickChange = (sym: string): number =>
    history24h.data?.[sym]?.changePct ?? 0;

  const topGainers = useMemo(() => {
    return [...STOCKS]
      .filter((s) => pickChange(s.sym) > 0)
      .sort((a, b) => pickChange(b.sym) - pickChange(a.sym))
      .slice(0, 3);
  }, [history24h.data]);

  const topLosers = useMemo(() => {
    return [...STOCKS]
      .filter((s) => pickChange(s.sym) < 0)
      .sort((a, b) => pickChange(a.sym) - pickChange(b.sym))
      .slice(0, 3);
  }, [history24h.data]);

  const stocks = useMemo(() => {
    let list = STOCKS.filter((s) => matchSector(s, sector));

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.sym.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.sector.toLowerCase().includes(q),
      );
    }

    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sortKey === "sym") return a.sym.localeCompare(b.sym) * dir;
      if (sortKey === "price") return (a.price - b.price) * dir;
      if (sortKey === "change") return (pickChange(a.sym) - pickChange(b.sym)) * dir;
      if (sortKey === "ltv") return (a.ltv - b.ltv) * dir;
      if (sortKey === "volatility") return (a.volatility - b.volatility) * dir;
      return 0;
    });

    return list;
  }, [sector, search, sortKey, sortDir, history24h.data]);

  // Format 1e18 USD bigint into a 2-decimal USD string ("$1,234.56").
  const fmtUsd1e18 = (v: bigint | null): string =>
    v == null ? "—" : fmt.usd(Number(v / 10n ** 12n) / 1e6, 2);
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

      <main id="main-content">
      <div className="max-w-[1320px] w-full mx-auto px-4 sm:px-8 pt-5 sm:pt-7 pb-4">
        <SectionHead
          kicker={`Markets · ${stats.assetCount ?? STOCKS.length} listed assets · Pyth Network oracles`}
          title="Pledge any holding. Borrow against it. Or let it earn."
        />
      </div>

      {/* ── Top Gainers / Top Losers ───────────────────────────── */}
      <div className="max-w-[1320px] w-full mx-auto px-4 sm:px-8 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MoverColumn
            title="Top Gainers"
            badge="24H"
            items={topGainers}
            pickChange={pickChange}
          />
          <MoverColumn
            title="Top Losers"
            badge="24H"
            items={topLosers}
            pickChange={pickChange}
          />
        </div>
      </div>

      <section className="border-y border-hairline bg-paper-alt overflow-x-auto">
        <div className="max-w-[1320px] w-full mx-auto px-4 sm:px-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map(([label, val, sub], i) => (
            <div
              key={label}
              className={`px-4 sm:px-5 py-3.5 ${i < 4 ? "lg:border-r border-hairline" : ""} ${i % 2 === 0 && i < 4 ? "sm:border-r" : ""}`}
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

      {/* ── Filter bar ─────────────────────────────────────────── */}
      <div className="max-w-[1320px] w-full mx-auto px-4 sm:px-8 pt-5 pb-3">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          {/* Search */}
          <div
            className="flex items-center gap-2 border border-hairline rounded-[2px] bg-paper px-3 py-2 flex-1 sm:max-w-[280px]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="var(--ink-mute)"
              strokeWidth="1.4"
              strokeLinecap="round"
              className="shrink-0"
            >
              <circle cx="6" cy="6" r="4.5" />
              <path d="M9.5 9.5 13 13" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticker or name…"
              className="bg-transparent outline-none border-0 flex-1 font-mono text-ink min-w-0"
              style={{ fontSize: 12 }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-ink-mute hover:text-ink bg-transparent border-0"
                style={{ fontSize: 14, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            )}
          </div>

          {/* Sector tabs + sort */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-0.5 bg-paper-alt border border-hairline-soft rounded-[2px] p-[3px]">
              {SECTORS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSector(s.id)}
                  className="border-0 rounded-[2px] transition-colors font-mono"
                  style={{
                    padding: "5px 10px",
                    fontSize: 11,
                    background: sector === s.id ? "var(--ink)" : "transparent",
                    color: sector === s.id ? "var(--paper)" : "var(--ink-soft)",
                    fontWeight: sector === s.id ? 500 : 400,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-hairline hidden sm:block" />

            <select
              value={`${sortKey}-${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split("-") as [SortKey, "asc" | "desc"];
                setSortKey(k);
                setSortDir(d);
              }}
              className="font-mono bg-paper border border-hairline rounded-[2px] text-ink-soft cursor-pointer outline-none"
              style={{ fontSize: 11, padding: "5px 8px" }}
            >
              <option value="sym-asc">A → Z</option>
              <option value="sym-desc">Z → A</option>
              <option value="price-desc">Price ↓</option>
              <option value="price-asc">Price ↑</option>
              <option value="change-desc">24h ↓</option>
              <option value="change-asc">24h ↑</option>
              <option value="ltv-desc">LTV ↓</option>
              <option value="volatility-desc">Volatility ↓</option>
            </select>
          </div>
        </div>

        {/* Result count */}
        <div
          className="mt-2.5 font-mono text-ink-mute flex items-center gap-2"
          style={{ fontSize: 10, letterSpacing: "0.06em" }}
        >
          <span>{stocks.length} asset{stocks.length !== 1 ? "s" : ""}</span>
          {sector !== "all" && (
            <>
              <span>·</span>
              <span>{SECTORS.find((s) => s.id === sector)?.label}</span>
            </>
          )}
          {search.trim() && (
            <>
              <span>·</span>
              <span>"{search.trim()}"</span>
            </>
          )}
        </div>
      </div>

      <div className="max-w-[1320px] w-full mx-auto px-4 sm:px-8 flex-1 flex flex-col overflow-x-auto">
        <div style={{ minWidth: 900 }}>
        {/* Column headers */}
        <div
          className="grid gap-4 py-2.5 border-b border-hairline text-ink-mute uppercase font-medium"
          style={{
            gridTemplateColumns: "1.8fr 1fr 0.8fr 0.9fr 1fr 1fr 0.85fr 100px",
            fontSize: 10,
            letterSpacing: "0.12em",
          }}
        >
          <div>Asset</div>
          <div className="text-right">Last · Oracle</div>
          <div className="text-right">Max LTV</div>
          <div className="text-right">Borrow APR</div>
          <div className="text-right">Vault APR</div>
          <div className="text-right">Volume</div>
          <div className="text-right">24h</div>
          <div />
        </div>

        <div className="flex-1">
          {stocks.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center text-center py-14"
            >
              <div
                className="font-serif font-medium text-ink-mute"
                style={{ fontSize: 18, letterSpacing: "-0.02em" }}
              >
                No assets match your filters.
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setSector("all");
                }}
                className="mt-3 font-mono text-ink-soft border border-hairline rounded-[2px] bg-transparent hover:border-ink hover:text-ink transition-colors"
                style={{ fontSize: 11, padding: "6px 14px" }}
              >
                Clear all filters
              </button>
            </div>
          ) : (
            stocks.map((s, i) => (
              <LedgerRow
                key={s.sym}
                stock={s}
                index={i}
                hovered={hoverSym === s.sym}
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
                collateralVolumeUsd={
                  stockAddress(s.sym)
                    ? stats.collateralByToken[stockAddress(s.sym)!.toLowerCase()] ?? null
                    : null
                }
                onPledge={() => setPledgeSym(s.sym)}
              />
            ))
          )}
        </div>
        </div>
      </div>
      </main>

      <PledgeSidebar
        sym={pledgeSym ?? "TSLA"}
        open={pledgeSym != null}
        onClose={() => setPledgeSym(null)}
      />

      <SiteFooter />
    </div>
  );
}

function MoverColumn({
  title,
  badge,
  items,
  pickChange,
}: {
  title: string;
  badge: string;
  items: Stock[];
  pickChange: (sym: string) => number;
}) {
  const router = useRouter();
  return (
    <div className="border border-hairline rounded-[2px] bg-paper">
      <div
        className="flex items-center gap-2 border-b border-hairline-soft"
        style={{ padding: "12px 16px" }}
      >
        <span className="font-medium" style={{ fontSize: 14 }}>
          {title}
        </span>
        <span
          className="font-mono rounded-[2px] bg-paper-alt border border-hairline-soft"
          style={{ fontSize: 9, padding: "2px 6px", letterSpacing: "0.06em" }}
        >
          {badge}
        </span>
      </div>
      {items.length === 0 ? (
        <div
          className="text-ink-mute font-mono text-center"
          style={{ padding: "20px 16px", fontSize: 11 }}
        >
          No data yet
        </div>
      ) : (
        items.map((s, i) => (
          <MoverRow
            key={s.sym}
            stock={s}
            pct={pickChange(s.sym)}
            isLast={i === items.length - 1}
          />
        ))
      )}
    </div>
  );
}

function MoverRow({ stock: s, pct, isLast }: { stock: Stock; pct: number; isLast: boolean }) {
  const router = useRouter();
  const adapterTick = useLiveAdapterTick(s.sym, (v) => fmt.usd(v));
  const simTick = useLiveTick(s.price, s.volatility, (v) => fmt.usd(v));
  const live = adapterTick.isLive ? adapterTick : simTick;
  const up = pct >= 0;

  return (
    <div
      onClick={() => router.push(`/markets/${s.sym}`)}
      className="flex items-center justify-between cursor-pointer hover:bg-paper-alt transition-colors"
      style={{
        padding: "10px 16px",
        borderBottom: isLast ? "none" : "1px solid var(--hairline-soft)",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="border border-ink rounded-[2px] flex items-center justify-center bg-paper"
          style={{ width: 32, height: 32 }}
        >
          <AssetLogo sym={s.sym} size={20} />
        </div>
        <div>
          <div className="font-mono font-semibold" style={{ fontSize: 12 }}>
            {s.sym}
          </div>
          <div className="text-ink-mute" style={{ fontSize: 10 }}>
            {s.name}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div
          className="font-serif tabular font-medium"
          style={{ fontSize: 14, letterSpacing: "-0.02em" }}
        >
          {live.formatted}
        </div>
        <div
          className="font-mono tabular font-medium"
          style={{
            fontSize: 11,
            color: up ? "var(--up)" : "var(--down)",
          }}
        >
          {fmt.pct(pct, 2, true)}
        </div>
      </div>
    </div>
  );
}

function LedgerRow({
  stock,
  index,
  hovered,
  onHover,
  onLeave,
  live24hPct,
  sparkData,
  sparkEnabled,
  derivedBorrowApr,
  derivedVaultApr,
  collateralVolumeUsd,
  onPledge,
}: {
  stock: Stock;
  index: number;
  hovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  live24hPct: number | null;
  sparkData?: number[];
  sparkEnabled: boolean;
  derivedBorrowApr: number | null;
  derivedVaultApr: number | null;
  collateralVolumeUsd: bigint | null;
  onPledge: () => void;
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
        gridTemplateColumns: "1.8fr 1fr 0.8fr 0.9fr 1fr 1fr 0.85fr 100px",
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
              ? "Flat borrow rate from vault.borrowApyBps() (5%); no kinked IRM is wired (irm()=0x0)."
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
          {fmt.signedPct(derivedVaultApr ?? 0, 2)}
        </div>
        <div className="text-ink-mute mt-0.5" style={{ fontSize: 10 }}>
          LP yield · protocol
        </div>
      </div>

      {/* Volume */}
      <div className="text-right">
        <div className="font-mono tabular font-medium" style={{ fontSize: 13 }}>
          {collateralVolumeUsd != null && collateralVolumeUsd > 0n
            ? fmt.usd(Number(collateralVolumeUsd / 10n ** 12n) / 1e6, 2)
            : "—"}
        </div>
        <div className="text-ink-mute mt-0.5" style={{ fontSize: 10 }}>
          collateral locked
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

      {/* Pledge action */}
      <div className="text-right">
        {onChain ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPledge(); }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-ink rounded-[2px] transition-all duration-150 font-medium"
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
          </button>
        ) : (
          <span
            className="inline-flex items-center px-3.5 py-2 border border-hairline rounded-[2px] font-medium text-ink-mute"
            style={{ fontSize: 12, cursor: "not-allowed" }}
          >
            Soon
          </span>
        )}
      </div>
    </div>
  );
}
