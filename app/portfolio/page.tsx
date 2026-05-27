"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useAccount,
  useBlockNumber,
  useConnect,
  useReadContract,
} from "wagmi";
import { PageNav } from "@/components/PageNav";
import { OraclePing } from "@/components/OraclePing";
import { SiteFooter } from "@/components/SiteFooter";
import { StaleOracleBanner } from "@/components/StaleOracleBanner";
import { BorrowMoreModal } from "@/components/BorrowMoreModal";
import { WithdrawCollateralModal } from "@/components/WithdrawCollateralModal";
import { RepayDebtModal } from "@/components/RepayDebtModal";
import { LpDepositModal } from "@/components/LpDepositModal";
import { LpWithdrawModal } from "@/components/LpWithdrawModal";
import { STOCKS, findStock } from "@/lib/config/stocks";
import { useProtocolStats, useListedAssets } from "@/lib/hooks/use-protocol-stats";
import { fmt } from "@/lib/format";
import {
  EQUIFLOW_VAULT_ABI,
  STOCK_TOKEN_ADDRESSES,
  explorerTx,
  shortAddr,
} from "@/lib/contracts";
import { AssetLogo } from "@/components/AssetLogo";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { usePosition, type LiveCollateralLine } from "@/lib/hooks/use-position";
import { usePositionEvents } from "@/lib/hooks/use-position-events";
import { useActiveWallet } from "@/lib/hooks/use-active-wallet";
import { useLiveAdapterTick, useStockPrices } from "@/lib/hooks/use-adapter-price";
import { SessionBadge } from "@/components/SessionBadge";
import type { Address } from "viem";
import { VaultSelector } from "@/components/VaultSelector";
import { useVaultContext } from "@/lib/hooks/use-vault-context";

export default function PositionsPage() {
  const { vault } = useVaultContext();
  const pos = usePosition();
  const { isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const listed = useListedAssets(vault.address);
  const protocolStats = useProtocolStats(listed, vault.address, vault.tokenAddress);

  // ── derived display ──────────────────────────────────────────────────
  const lines = pos.lines;
  const collateralUsd = pos.collateralUsd;
  const borrowedUsd = pos.borrowedUsd;
  const healthFactorRaw =
    pos.healthFactor === Number.POSITIVE_INFINITY ? 99 : pos.healthFactor;
  const ltvCapBps = blendedLtv(lines);
  const liqAtBps = pos.liqThresholdPct != null
    ? pos.liqThresholdPct * 100
    : blendedLiq(lines);
  const ltvActual =
    collateralUsd > 0 ? (borrowedUsd / collateralUsd) * 100 : 0;
  const ltvCap = ltvCapBps / 100;
  const liqAt = liqAtBps / 100;
  const healthFactor = healthFactorRaw;
  const tension = Math.max(0, Math.min(1, (2.5 - healthFactor) / 1.5));
  const HFTone =
    healthFactor > 2.5
      ? "var(--up)"
      : healthFactor > 1.5
        ? "var(--amber)"
        : "var(--down)";
  const statusLabel =
    healthFactor > 2 ? "HEALTHY" : healthFactor > 1.3 ? "WATCH" : "AT-RISK";

  const equity = collateralUsd - borrowedUsd;
  const headroom = Math.max(0, collateralUsd * (ltvCap / 100) - borrowedUsd);
  const borrowApr = protocolStats.derived ? protocolStats.derived.borrowAprBps / 100 : null;
  const vaultApr = protocolStats.derived ? protocolStats.derived.supplyAprBps / 100 : null;

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav
        current="portfolio"
        rightExtras={
          <OraclePing
            label={pos.vaultConfigured ? "Vault · on-chain" : `${lines.length} oracles streaming`}
          />
        }
      />

      {pos.oracleStale && <StaleOracleBanner />}

      <div className="max-w-[1320px] w-full mx-auto flex-1 flex flex-col">
        {/* Position selector bar */}
        <PositionSelectorBar
          assetCount={lines.length}
          statusLabel={statusLabel}
          HFTone={HFTone}
          isConnected={isConnected}
        />

        {/* 5-KPI banner */}
        <section
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 bg-paper-alt"
          style={{ borderBottom: "1px solid var(--ink)" }}
        >
          <Kpi
            label="Collateral · total"
            value={fmt.usd(collateralUsd, 0)}
            sub={`${lines.length} asset${lines.length !== 1 ? "s" : ""} pledged`}
          />
          <Kpi
            label={`Debt · ${vault.borrowSymbol}`}
            value={fmt.usd(borrowedUsd, 0)}
            sub={borrowApr != null ? `@ ${borrowApr.toFixed(2)}% APR` : "—"}
          />
          <Kpi
            label="Net equity"
            value={fmt.usd(equity, 0)}
            sub={`LTV ${ltvActual.toFixed(1)}% / cap ${ltvCap.toFixed(0)}%`}
          />
          <Kpi
            label="Health factor"
            value={healthFactor >= 99 ? "∞" : healthFactor.toFixed(2)}
            valueColor={HFTone}
            sub={`liquidates at 1.00 · liq LTV ${liqAt.toFixed(0)}%`}
          />
          <Kpi
            label="Borrow capacity"
            value={fmt.usd(headroom, 0)}
            sub="remaining headroom"
            last
          />
        </section>

        {!isConnected && (
          <div
            className="border-b border-hairline-soft flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 sm:px-8 py-3"
            style={{ background: "var(--amber-soft)" }}
          >
            <span style={{ fontSize: 12 }} className="text-ink-soft">
              Wallet not connected — connect to view your position.
            </span>
            <button
              type="button"
              onClick={() => {
                const c = connectors[0];
                if (c)
                  connect({
                    connector: c,
                    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
                  });
              }}
              className="px-3 py-1.5 bg-ink text-paper rounded-[2px] font-medium"
              style={{ fontSize: 12 }}
            >
              Connect wallet
            </button>
          </div>
        )}

        {/* Orbit + Collateral/Debt tables */}
        {pos.hasPosition || !isConnected ? (
          <section
            className="grid grid-cols-1 lg:[grid-template-columns:1.05fr_1fr] border-b border-hairline"
          >
            {/* LEFT: orbit */}
            <div
              className="lg:border-r border-hairline border-b lg:border-b-0"
              style={{ padding: "24px 16px" }}
            >
              <div className="flex justify-between items-center mb-1">
                <div className="eyebrow flex items-center gap-3">
                  <span>Position view</span>
                  <VaultSelector compact />
                </div>
                <span
                  className="font-mono text-ink-mute"
                  style={{ fontSize: 10, letterSpacing: "0.06em" }}
                >
                  REAL-TIME · {lines.length} oracles
                </span>
              </div>

              <Orbit
                positions={lines}
                tension={tension}
                borrowed={borrowedUsd}
              />

              <div
                className="mt-4 bg-paper-alt border border-hairline-soft flex gap-5 flex-wrap"
                style={{ padding: "12px 14px" }}
              >
                <LegendItem dot="var(--ink)" label="Loan" desc={`${vault.borrowSymbol} borrowed`} />
                <LegendItem
                  ring
                  label="Collateral"
                  desc="orbit radius ∝ contribution"
                />
                <LegendItem
                  dot="var(--up)"
                  label="Breathing"
                  desc="oracle tick"
                />
                <LegendItem
                  dot="var(--down)"
                  label="Liquidation arc"
                  desc="collapses if LTV breaches"
                />
              </div>
            </div>

            {/* RIGHT: collateral + debt tables */}
            <div className="flex flex-col">
              <CollateralTable
                positions={lines}
                totalCollat={collateralUsd}
              />
              <DebtPanel
                borrowed={borrowedUsd}
                borrowApr={borrowApr}
                vaultApr={vaultApr}
              />
            </div>
          </section>
        ) : (
          <EmptyState />
        )}

        {pos.hasPosition || !isConnected ? (
          <>
            <section
              className="grid grid-cols-1 lg:[grid-template-columns:1fr_280px] border-b border-hairline"
            >
              <PerfChart
                healthFactor={healthFactor}
                totalCollat={collateralUsd}
              />
              <PositionActions
                hasPosition={pos.hasPosition && pos.vaultConfigured}
                borrowedUsd={borrowedUsd}
                headroom={headroom}
                lines={lines}
                collateralUsd={collateralUsd}
                ltvCap={ltvCap}
                liqAt={liqAt}
              />
            </section>

            <LpPoolPanel />

            <section
              className="grid grid-cols-1 md:grid-cols-2"
            >
              <OracleActivityLog
                stocks={lines}
                healthFactor={healthFactor}
              />
              <TxHistory />
            </section>
          </>
        ) : null}
      </div>

      <SiteFooter />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   POSITION SELECTOR BAR
   ────────────────────────────────────────────────────────── */
function PositionSelectorBar({
  assetCount,
  statusLabel,
  HFTone,
  isConnected,
}: {
  assetCount: number;
  statusLabel: string;
  HFTone: string;
  isConnected: boolean;
}) {
  const { vault } = useVaultContext();
  const vaultAddr = vault.address;
  const { address } = useActiveWallet();
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawLpOpen, setWithdrawLpOpen] = useState(false);

  const { data: lpPos } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vaultAddr,
    functionName: "lpPositionOf",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: {
      enabled: !!vaultAddr && !!address,
      refetchInterval: 15_000,
    },
  });
  const userHasShares =
    !!lpPos &&
    ((lpPos as readonly [bigint, bigint, bigint])[0]) > 0n;

  return (
    <section
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-hairline-soft px-4 sm:px-7 py-3 sm:py-3.5"
    >
      <div className="flex items-center gap-3 sm:gap-5 flex-wrap">
        <div
          className="flex items-center gap-2.5 border border-ink rounded-[2px] cursor-pointer"
          style={{ padding: "6px 12px" }}
        >
          <span
            className="font-mono text-ink-mute uppercase"
            style={{ fontSize: 11, letterSpacing: "0.06em" }}
          >
            POSITION
          </span>
          <span
            className="font-serif font-medium"
            style={{ fontSize: 15, letterSpacing: "-0.015em" }}
          >
            #{assetCount > 0 ? "001" : "—"}
          </span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2 4l3 3 3-3" />
          </svg>
        </div>
        <div
          className="hidden sm:flex items-center gap-4 flex-wrap"
          style={{ fontSize: 12 }}
        >
          <MetaItem k="Opened" v="—" />
          <MetaItem k="Pledged" v={`${assetCount} assets`} />
          <MetaItem k="Loan" v={vault.borrowSymbol} />
          <MetaItem
            k="Status"
            v={
              <span style={{ color: HFTone, fontWeight: 500 }}>
                {isConnected ? statusLabel : "DEMO"}
              </span>
            }
          />
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setDepositOpen(true)}
          className="font-medium rounded-[2px]"
          style={{
            padding: "7px 12px",
            fontSize: 12,
            background: "var(--up-soft)",
            color: "var(--ink)",
            border: "1px solid var(--up)",
          }}
          title={`Deposit ${vault.borrowSymbol} as LP · earn APY from borrow spread`}
        >
          ✦ Deposit LP
        </button>
        {userHasShares && (
          <button
            type="button"
            onClick={() => setWithdrawLpOpen(true)}
            className="bg-transparent text-ink border border-ink rounded-[2px] font-medium"
            style={{ padding: "7px 12px", fontSize: 12 }}
          >
            Withdraw LP
          </button>
        )}
        <button
          type="button"
          className="bg-transparent text-ink border border-hairline rounded-[2px] font-medium"
          style={{ padding: "7px 12px", fontSize: 12 }}
        >
          Export · CSV
        </button>
      </div>
      <LpDepositModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
      />
      <LpWithdrawModal
        open={withdrawLpOpen}
        onClose={() => setWithdrawLpOpen(false)}
      />
    </section>
  );
}

function MetaItem({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="font-mono text-ink-mute uppercase"
        style={{ fontSize: 10, letterSpacing: "0.06em" }}
      >
        {k}
      </span>
      <span className="font-mono" style={{ fontSize: 11 }}>
        {v}
      </span>
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────
   5-KPI CELL
   ────────────────────────────────────────────────────────── */
function Kpi({
  label,
  value,
  valueColor,
  sub,
  subColor,
  last,
}: {
  label: string;
  value: string;
  valueColor?: string;
  sub: string;
  subColor?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "20px 26px",
        borderRight: last ? "none" : "1px solid var(--hairline)",
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {label}
      </div>
      <div
        className="font-serif font-medium tabular"
        style={{
          fontSize: 30,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: valueColor ?? "var(--ink)",
        }}
      >
        {value}
      </div>
      <div
        className="font-mono tabular"
        style={{
          fontSize: 11,
          color: subColor ?? "var(--ink-mute)",
          marginTop: 8,
        }}
      >
        {sub}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   COLLATERAL TABLE
   ────────────────────────────────────────────────────────── */
function CollateralTable({
  positions,
  totalCollat,
}: {
  positions: LiveCollateralLine[];
  totalCollat: number;
}) {
  const enriched = useMemo(() => {
    return positions
      .map((p) => {
        const stock = findStock(p.sym);
        const value = stock.price * p.shares;
        return { ...p, stock, value, weight: value / Math.max(totalCollat, 1) };
      })
      .sort((a, b) => b.value - a.value);
  }, [positions, totalCollat]);

  return (
    <div
      className="border-b border-hairline"
      style={{ padding: "20px 24px 12px" }}
    >
      <div className="flex justify-between items-baseline" style={{ marginBottom: 12 }}>
        <div>
          <div className="eyebrow mb-1">
            Collateral · {enriched.length} assets
          </div>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 16, letterSpacing: "-0.02em" }}
          >
            Per-asset breakdown
          </h3>
        </div>
        <span
          className="font-mono tabular font-medium"
          style={{ fontSize: 14 }}
        >
          {fmt.usd(totalCollat, 0)}
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--ink)" }}>
            <th style={collatHeadStyle}>Asset</th>
            <th style={{ ...collatHeadStyle, textAlign: "right" }}>Shares</th>
            <th style={{ ...collatHeadStyle, textAlign: "right" }}>Live price</th>
            <th style={{ ...collatHeadStyle, textAlign: "right" }}>Value</th>
            <th style={{ ...collatHeadStyle, textAlign: "right" }}>Weight</th>
          </tr>
        </thead>
        <tbody>
          {enriched.map((p) => (
            <CollatRow key={p.sym} pos={p} />
          ))}
          <tr>
            <td
              colSpan={3}
              className="font-mono text-ink-mute uppercase"
              style={{
                padding: "12px 0 6px",
                fontSize: 11,
                letterSpacing: "0.04em",
              }}
            >
              Total
            </td>
            <td
              style={{ padding: "12px 8px 6px", textAlign: "right" }}
            >
              <span
                className="font-mono tabular font-semibold"
                style={{ fontSize: 13 }}
              >
                {fmt.usd(totalCollat, 0)}
              </span>
            </td>
            <td
              style={{ padding: "12px 8px 6px", textAlign: "right" }}
            >
              <span
                className="font-mono tabular text-ink-mute"
                style={{ fontSize: 12 }}
              >
                100.0%
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const collatHeadStyle: React.CSSProperties = {
  padding: "8px 8px",
  textAlign: "left",
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--ink-mute)",
  fontWeight: 500,
};

function CollatRow({
  pos: p,
}: {
  pos: LiveCollateralLine & {
    stock: ReturnType<typeof findStock>;
    value: number;
    weight: number;
  };
}) {
  // Single source of truth: on-chain Pyth price via adapter.latestRoundData.
  // Falls back to static catalogue for assets without an on-chain adapter.
  const live = useLiveAdapterTick(p.sym, (v) => fmt.usd(v));
  const livePrice = live.value;
  const up = live.dir >= 0;
  return (
    <tr style={{ borderBottom: "1px dashed var(--hairline-soft)" }}>
      <td style={{ padding: "12px 8px" }}>
        <div className="flex items-center gap-2.5">
          <div
            className="border border-ink bg-paper rounded-[2px] flex items-center justify-center"
            style={{ width: 26, height: 26 }}
          >
            <AssetLogo sym={p.sym} size={18} />
          </div>
          <div>
            <div className="font-mono font-semibold" style={{ fontSize: 12 }}>
              {p.sym}
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 9,
                color: up ? "var(--up)" : "var(--down)",
                marginTop: 1,
              }}
            >
              {live.isLive ? fmt.pct(((live.value - p.stock.price) / p.stock.price) * 100, 2, true) : "—"}
            </div>
          </div>
        </div>
      </td>
      <td style={{ padding: "12px 8px", textAlign: "right" }}>
        <span className="font-mono tabular" style={{ fontSize: 12 }}>
          {fmt.num(p.shares, p.shares < 1 ? 4 : 0)}
        </span>
      </td>
      <td style={{ padding: "12px 8px", textAlign: "right" }}>
        <div className="flex items-center justify-end gap-1.5">
          <span
            className={`font-mono tabular inline-block rounded-[2px] ${
              live.dir > 0
                ? "animate-tick-up"
                : live.dir < 0
                  ? "animate-tick-down"
                  : ""
            }`}
            style={{
              fontSize: 12,
              padding: "1px 4px",
            }}
            title={live.isLive ? "Pyth · on-chain" : "Static reference price"}
          >
            {live.formatted}
          </span>
          {live.isLive && <SessionBadge symbol={p.sym} variant="dense" />}
        </div>
      </td>
      <td style={{ padding: "12px 8px", textAlign: "right" }}>
        <span
          className="font-serif tabular font-medium"
          style={{ fontSize: 14, letterSpacing: "-0.02em" }}
        >
          {fmt.usd(livePrice * p.shares, 0)}
        </span>
      </td>
      <td style={{ padding: "12px 8px", textAlign: "right" }}>
        <div className="font-mono tabular" style={{ fontSize: 11 }}>
          {(p.weight * 100).toFixed(1)}%
        </div>
        <div
          style={{
            height: 2,
            background: "var(--hairline-soft)",
            marginTop: 3,
          }}
        >
          <div
            style={{
              width: `${p.weight * 100}%`,
              height: "100%",
              background: "var(--ink)",
            }}
          />
        </div>
      </td>
    </tr>
  );
}

/* ──────────────────────────────────────────────────────────────
   DEBT PANEL
   ────────────────────────────────────────────────────────── */
function DebtPanel({
  borrowed,
  borrowApr,
  vaultApr,
}: {
  borrowed: number;
  borrowApr: number | null;
  vaultApr: number | null;
}) {
  const netApy = borrowApr != null && vaultApr != null ? vaultApr - borrowApr : null;
  return (
    <div style={{ padding: "20px 24px" }}>
      <div className="flex justify-between items-baseline" style={{ marginBottom: 12 }}>
        <div>
          <div className="eyebrow mb-1">Debt · USDG</div>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 16, letterSpacing: "-0.02em" }}
          >
            Borrow & yield
          </h3>
        </div>
        <span
          className="font-mono tabular font-medium"
          style={{ fontSize: 14 }}
        >
          {fmt.usd(borrowed, 0)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div
          className="bg-paper-alt border border-hairline-soft"
          style={{ padding: "12px 14px" }}
        >
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Borrow rate
          </div>
          <div
            className="font-serif font-medium tabular text-down"
            style={{ fontSize: 22, letterSpacing: "-0.025em" }}
          >
            {borrowApr != null ? `−${borrowApr.toFixed(2)}%` : "—"}
          </div>
          <div
            className="font-mono text-ink-mute"
            style={{ fontSize: 10, marginTop: 4 }}
          >
            APR · on-chain
          </div>
        </div>
        <div
          className="bg-paper-alt border border-hairline-soft"
          style={{ padding: "12px 14px" }}
        >
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Supply rate
          </div>
          <div
            className="font-serif font-medium tabular text-up"
            style={{ fontSize: 22, letterSpacing: "-0.025em" }}
          >
            {vaultApr != null ? `+${vaultApr.toFixed(2)}%` : "—"}
          </div>
          <div
            className="font-mono text-ink-mute"
            style={{ fontSize: 10, marginTop: 4 }}
          >
            APR · vault LP
          </div>
        </div>
      </div>
      <div
        className="bg-ink text-paper rounded-[2px]"
        style={{ marginTop: 12, padding: "12px 14px" }}
      >
        <div className="flex justify-between items-baseline">
          <div>
            <div
              className="font-mono"
              style={{ fontSize: 10, opacity: 0.6, letterSpacing: "0.1em" }}
            >
              NET YOU KEEP
            </div>
            <div
              className="font-serif font-medium tabular"
              style={{
                fontSize: 22,
                letterSpacing: "-0.025em",
                color: "var(--up-soft)",
              }}
            >
              {netApy != null ? `+${netApy.toFixed(2)}% APY` : "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   PERFORMANCE CHART · 35 days
   ────────────────────────────────────────────────────────── */
function PerfChart({
  healthFactor,
  totalCollat,
}: {
  healthFactor: number;
  totalCollat: number;
}) {
  const DAYS = 30;
  const W = 1100;
  const H = 180;
  const PAD_T = 24;
  const PAD_B = 22;
  const PAD_L = 52;

  const data = useMemo(() => {
    const hf0 = Math.min(99, healthFactor);
    const c0 = totalCollat;
    const out: { d: number; hf: number; c: number }[] = [];
    let hf = hf0 * 0.92;
    let c = c0 * 0.94;
    let seed = Math.round(hf0 * 1000 + c0) % 233280;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280 - 0.5;
    };
    for (let i = 0; i <= DAYS; i++) {
      const t = i / DAYS;
      hf += rng() * 0.15 + (hf0 - hf) * 0.08;
      c += rng() * c0 * 0.012 + (c0 - c) * 0.06;
      if (i === DAYS) { hf = hf0; c = c0; }
      out.push({ d: i, hf: Math.max(0.5, hf), c: Math.max(0, c) });
    }
    return out;
  }, [healthFactor, totalCollat]);

  const hfVals = data.map((d) => d.hf);
  const cVals = data.map((d) => d.c);
  const minHf = Math.max(0, Math.min(...hfVals) - 0.3);
  const maxHf = Math.max(...hfVals) + 0.3;
  const minC = Math.min(...cVals) * 0.96;
  const maxC = Math.max(...cVals) * 1.04;
  const rangeC = maxC - minC || 1;

  const chartH = H - PAD_T - PAD_B;
  const chartW = W - PAD_L;
  const xAt = (i: number) => PAD_L + (i / DAYS) * chartW;
  const yHf = (v: number) => PAD_T + (1 - (v - minHf) / (maxHf - minHf || 1)) * chartH;
  const yC = (v: number) => PAD_T + (1 - (v - minC) / rangeC) * chartH;

  const smooth = (pts: { x: number; y: number }[]) => {
    if (pts.length < 2) return "";
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  };

  const hfPts = data.map((d, i) => ({ x: xAt(i), y: yHf(d.hf) }));
  const cPts = data.map((d, i) => ({ x: xAt(i), y: yC(d.c) }));
  const pathHf = smooth(hfPts);
  const pathC = smooth(cPts);
  const areaC = pathC + ` L ${xAt(DAYS)},${PAD_T + chartH} L ${PAD_L},${PAD_T + chartH} Z`;

  const watchY = yHf(1.5);
  const showWatch = watchY > PAD_T && watchY < PAD_T + chartH;

  const hfTicks = [];
  const step = maxHf - minHf > 4 ? 2 : maxHf - minHf > 2 ? 1 : 0.5;
  for (let v = Math.ceil(minHf / step) * step; v <= maxHf; v += step) {
    hfTicks.push(v);
  }

  const dayLabels = [0, 7, 14, 21, 30];

  return (
    <div
      className="px-4 sm:px-7 py-5 lg:border-r border-hairline"
    >
      <div className="flex flex-col sm:flex-row justify-between sm:items-baseline gap-2 mb-4">
        <div>
          <div className="eyebrow mb-1">Position snapshot</div>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 18, letterSpacing: "-0.02em" }}
          >
            Health factor + collateral · 30d
          </h3>
        </div>
        <div className="flex gap-5" style={{ fontSize: 11 }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block bg-ink rounded-full" style={{ width: 8, height: 8 }} />
            <span className="font-mono text-ink-soft">Health factor</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block bg-up rounded-full" style={{ width: 8, height: 8 }} />
            <span className="font-mono text-ink-soft">Collateral value</span>
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block">
        <defs>
          <linearGradient id="ef-collat-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--up)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--up)" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {hfTicks.map((v) => {
          const y = yHf(v);
          if (y < PAD_T || y > PAD_T + chartH) return null;
          return (
            <g key={v}>
              <line
                x1={PAD_L} x2={W} y1={y} y2={y}
                stroke="var(--hairline-soft)" strokeDasharray="2 4"
              />
              <text
                x={PAD_L - 8} y={y + 3}
                fontSize="9" fontFamily="JetBrains Mono" fill="var(--ink-mute)"
                textAnchor="end"
              >
                {v.toFixed(v % 1 === 0 ? 0 : 1)}
              </text>
            </g>
          );
        })}

        {showWatch && (
          <>
            <rect
              x={PAD_L} y={watchY} width={chartW}
              height={Math.min(PAD_T + chartH - watchY, chartH)}
              fill="var(--down-soft)" opacity="0.25"
            />
            <line
              x1={PAD_L} x2={W} y1={watchY} y2={watchY}
              stroke="var(--down)" strokeDasharray="4 4" strokeWidth="1" opacity="0.6"
            />
            <text
              x={PAD_L + 6} y={watchY + 12}
              fontSize="8" fontFamily="JetBrains Mono" fill="var(--down)"
              letterSpacing="0.08em" opacity="0.7"
            >
              WATCH ZONE · HF &lt; 1.5
            </text>
          </>
        )}

        <path d={areaC} fill="url(#ef-collat-fill)" />
        <path d={pathC} stroke="var(--up)" strokeWidth="1.6" fill="none" />
        <path d={pathHf} stroke="var(--ink)" strokeWidth="1.8" fill="none" />

        <circle cx={hfPts[DAYS].x} cy={hfPts[DAYS].y} r="4" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.6" />
        <circle cx={cPts[DAYS].x} cy={cPts[DAYS].y} r="4" fill="var(--paper)" stroke="var(--up)" strokeWidth="1.6" />

        <text
          x={hfPts[DAYS].x - 8} y={hfPts[DAYS].y - 10}
          fontSize="10" fontFamily="JetBrains Mono" fontWeight="600"
          fill="var(--ink)" textAnchor="end"
        >
          {healthFactor >= 99 ? "∞" : healthFactor.toFixed(2)}
        </text>
        <text
          x={cPts[DAYS].x - 8} y={cPts[DAYS].y - 10}
          fontSize="10" fontFamily="JetBrains Mono" fontWeight="600"
          fill="var(--up)" textAnchor="end"
        >
          {fmt.usd(totalCollat, 0)}
        </text>

        {dayLabels.map((d) => (
          <text
            key={d}
            x={xAt(d)} y={H - 4}
            fontSize="9" fontFamily="JetBrains Mono" fill="var(--ink-mute)"
            textAnchor={d === 0 ? "start" : d === 30 ? "end" : "middle"}
          >
            {d === 30 ? "now" : `−${30 - d}d`}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   POSITION ACTIONS · 4-button grid
   ────────────────────────────────────────────────────────── */
function PositionActions({
  hasPosition,
  borrowedUsd,
  headroom,
  lines,
  collateralUsd,
  ltvCap,
  liqAt,
}: {
  hasPosition: boolean;
  borrowedUsd: number;
  headroom: number;
  lines: LiveCollateralLine[];
  collateralUsd: number;
  ltvCap: number;
  liqAt: number;
}) {
  const { vault } = useVaultContext();
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [repayOpen, setRepayOpen] = useState(false);

  const minCollatRequired =
    ltvCap > 0 ? borrowedUsd / (ltvCap / 100) : 0;
  const maxWithdrawUsd = Math.max(0, collateralUsd - minCollatRequired);

  return (
    <>
      <div className="flex flex-col border-b lg:border-b-0 border-hairline">
        <div className="eyebrow px-5 pt-5 pb-2">Actions</div>
        <ActionBtn
          primary
          label="Repay debt"
          sub={
            borrowedUsd > 0
              ? `Settle ${fmt.usd(borrowedUsd, 2)} ${vault.borrowSymbol}`
              : "No outstanding debt"
          }
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v12M4 10l4 4 4-4" />
              <path d="M2 2h12" />
            </svg>
          }
          onClick={() => setRepayOpen(true)}
          disabled={!hasPosition || borrowedUsd <= 0}
        />
        <ActionBtn
          label="Add collateral"
          sub="Improve health factor"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="12" height="9" rx="1.5" />
              <path d="M5 5V3.5A3 3 0 0 1 11 3.5V5" />
              <path d="M8 8.5v3M6.5 10h3" />
            </svg>
          }
          href="/markets"
        />
        <ActionBtn
          label="Borrow more"
          sub={`Up to +${fmt.usd(headroom, 0)} available`}
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 14V2M4 6l4-4 4 4" />
              <path d="M2 14h12" />
            </svg>
          }
          onClick={() => setBorrowOpen(true)}
          disabled={!hasPosition || headroom <= 0}
        />
        <ActionBtn
          label="Withdraw collateral"
          sub={
            maxWithdrawUsd > 0
              ? `Up to ${fmt.usd(maxWithdrawUsd, 0)} LTV-safe`
              : "Repay debt first"
          }
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="12" height="9" rx="1.5" />
              <path d="M5 5V3.5A3 3 0 0 1 11 3.5V5" />
              <path d="M8 11.5v-3M6.5 10h3" opacity="0" />
              <path d="M8 8v3.5M5.5 10l2.5 2.5L10.5 10" />
            </svg>
          }
          last
          onClick={() => setWithdrawOpen(true)}
          disabled={!hasPosition || maxWithdrawUsd <= 0}
        />
      </div>

      <BorrowMoreModal
        open={borrowOpen}
        onClose={() => setBorrowOpen(false)}
        lines={lines}
        collateralUsd={collateralUsd}
        borrowedUsd={borrowedUsd}
        ltvCap={ltvCap}
        liqLtv={liqAt}
      />
      <WithdrawCollateralModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        lines={lines}
        collateralUsd={collateralUsd}
        borrowedUsd={borrowedUsd}
        ltvCap={ltvCap}
        liqLtv={liqAt}
      />
      <RepayDebtModal
        open={repayOpen}
        onClose={() => setRepayOpen(false)}
        borrowedUsd={borrowedUsd}
        collateralUsd={collateralUsd}
        ltvCap={ltvCap}
        liqLtv={liqAt}
      />
    </>
  );
}

function ActionBtn({
  primary,
  tone,
  label,
  sub,
  icon,
  last,
  href,
  onClick,
  disabled,
}: {
  primary?: boolean;
  tone?: "warn";
  label: string;
  sub: string;
  icon: React.ReactNode;
  last?: boolean;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const bg = primary ? "var(--ink)" : "var(--paper)";
  const fg = primary ? "var(--paper)" : "var(--ink)";
  const subFg = primary ? "rgba(250,248,242,.6)" : "var(--ink-mute)";
  const labelColor = tone === "warn" ? "var(--down)" : fg;
  const iconColor =
    tone === "warn"
      ? "var(--down)"
      : primary
        ? "var(--paper)"
        : "var(--ink)";
  const content = (
    <span className="flex items-center gap-3.5 w-full text-left">
      <span
        className="rounded-[2px] flex items-center justify-center shrink-0"
        style={{
          width: 32,
          height: 32,
          background: primary
            ? "rgba(250,248,242,.1)"
            : "var(--paper-alt)",
          border: `1px solid ${primary ? "rgba(250,248,242,.2)" : "var(--hairline)"}`,
          color: iconColor,
        }}
      >
        {icon}
      </span>
      <span>
        <span
          className="block font-medium"
          style={{ fontSize: 14, color: labelColor }}
        >
          {label}
        </span>
        <span
          className="block"
          style={{ fontSize: 11, color: subFg, marginTop: 2 }}
        >
          {sub}
        </span>
      </span>
    </span>
  );

  const baseStyle: React.CSSProperties = {
    padding: "14px 20px",
    background: bg,
    color: fg,
    border: "none",
    borderBottom: last ? "none" : "1px solid var(--hairline-soft)",
    borderRadius: 0,
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };

  if (href && !disabled) {
    return (
      <Link
        href={href}
        className="no-underline"
        style={{ ...baseStyle, display: "block" }}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={baseStyle}
    >
      {content}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────
   ORACLE ACTIVITY LOG
   ────────────────────────────────────────────────────────── */
function OracleActivityLog({
  stocks,
  healthFactor,
}: {
  stocks: LiveCollateralLine[];
  healthFactor: number;
}) {
  return (
    <div
      className="border-r border-hairline"
      style={{ padding: "20px 24px" }}
    >
      <div className="flex justify-between items-baseline" style={{ marginBottom: 12 }}>
        <div>
          <div className="eyebrow mb-1">
            Oracle activity
          </div>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 16, letterSpacing: "-0.02em" }}
          >
            Pyth stream
          </h3>
        </div>
        <OraclePing label={null} size={5} />
      </div>
      <div
        className="bg-ink text-paper rounded-[2px] font-mono"
        style={{ padding: "14px 16px", fontSize: 11, lineHeight: 1.7 }}
      >
        {stocks.length === 0 ? (
          <div style={{ opacity: 0.5 }}>No collateral pledged</div>
        ) : (
          stocks.map((l) => {
            const s = findStock(l.sym);
            return (
              <div key={l.sym} className="flex gap-3">
                <span
                  className="uppercase"
                  style={{
                    width: 42,
                    flexShrink: 0,
                    fontSize: 9,
                    opacity: 0.6,
                    letterSpacing: "0.08em",
                  }}
                >
                  price
                </span>
                <span>{s.sym} · {fmt.usd(s.price, 2)}</span>
              </div>
            );
          })
        )}
        <div className="flex gap-3 mt-1">
          <span
            className="uppercase"
            style={{
              width: 42,
              flexShrink: 0,
              fontSize: 9,
              opacity: 0.6,
              letterSpacing: "0.08em",
            }}
          >
            sys
          </span>
          <span style={{ color: "var(--amber)" }}>
            Health factor · {healthFactor >= 99 ? "∞" : healthFactor.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   LP POOL PANEL · public, real-time vault stats
   ────────────────────────────────────────────────────────── */
function LpPoolPanel() {
  const { vault } = useVaultContext();
  const vaultAddr = vault.address;
  const { address } = useActiveWallet();
  const { data: tvlRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vaultAddr,
    functionName: "totalAssetsUsd",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!vaultAddr, refetchInterval: 12_000 },
  });
  const { data: bookedRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vaultAddr,
    functionName: "bookedUsdg",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!vaultAddr, refetchInterval: 12_000 },
  });
  const { data: totalSharesRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vaultAddr,
    functionName: "totalShares",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!vaultAddr, refetchInterval: 12_000 },
  });
  const { data: apyRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vaultAddr,
    functionName: "lpApyBps",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!vaultAddr, refetchInterval: 12_000 },
  });
  const { data: utilizationRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vaultAddr,
    functionName: "utilizationBps",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!vaultAddr, refetchInterval: 12_000 },
  });
  const { data: borrowRateRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vaultAddr,
    functionName: "borrowRateBps",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!vaultAddr, staleTime: 60_000 },
  });
  const { data: myLp } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: vaultAddr,
    functionName: "lpPositionOf",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: {
      enabled: !!vaultAddr && !!address,
      refetchInterval: 12_000,
    },
  });

  const usdgDec = vault.tokenDecimals;

  const tvl = tvlRaw !== undefined ? Number(tvlRaw as bigint) / 1e18 : 0;
  const idle =
    bookedRaw !== undefined ? Number(bookedRaw as bigint) / 10 ** usdgDec : 0;
  const totalShares =
    totalSharesRaw !== undefined ? Number(totalSharesRaw as bigint) / 1e18 : 0;
  const apyPct = apyRaw !== undefined ? Number(apyRaw as bigint) / 100 : 0;
  const utilPct =
    utilizationRaw !== undefined ? Number(utilizationRaw as bigint) / 100 : 0;
  const borrowPct =
    borrowRateRaw !== undefined ? Number(borrowRateRaw as bigint) / 100 : 0;
  const [myShares, myUsdValue] = (myLp as
    | readonly [bigint, bigint, bigint]
    | undefined) ?? [0n, 0n, 0n];
  const myShareNum = Number(myShares) / 1e18;
  const myUsdNum = Number(myUsdValue) / 1e18;

  return (
    <section
      className="border-b border-hairline bg-paper-alt"
      style={{ padding: "24px 28px" }}
    >
      <div
        className="flex justify-between items-end"
        style={{ marginBottom: 16 }}
      >
        <div>
          <div className="eyebrow mb-1">Liquidity pool · open LP</div>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 20, letterSpacing: "-0.02em" }}
          >
            Deposit {vault.borrowSymbol}, earn from borrow spread
          </h3>
          <p
            className="text-ink-soft m-0"
            style={{ fontSize: 12, marginTop: 4, maxWidth: 540, lineHeight: 1.5 }}
          >
            Borrowers pay {borrowPct.toFixed(2)}% APR. Interest accrues
            on-chain into your share value. Withdraw anytime your share of vault
            {vault.borrowSymbol} is idle.
          </p>
        </div>
      </div>
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 bg-paper rounded-[2px] border border-hairline-soft"
        style={{ overflow: "hidden" }}
      >
        <PoolStat label="Vault TVL" value={fmt.usd(tvl, 0)} />
        <PoolStat
          label="LP APY"
          value={`+${apyPct.toFixed(2)}%`}
          color="var(--up)"
          sub={`= ${borrowPct.toFixed(1)}% × ${utilPct.toFixed(0)}% util`}
        />
        <PoolStat
          label="Utilization"
          value={`${utilPct.toFixed(1)}%`}
          sub={`${fmt.usd(tvl - idle, 0)} lent out`}
        />
        <PoolStat label={`Idle ${vault.borrowSymbol}`} value={fmt.usd(idle, 0)} />
        <PoolStat
          label="Your shares"
          value={
            myShareNum > 0 ? myShareNum.toFixed(myShareNum < 1 ? 4 : 2) : "—"
          }
          sub={
            myShareNum > 0
              ? `${fmt.usd(myUsdNum, 2)} · ${
                  totalShares > 0
                    ? ((myShareNum / totalShares) * 100).toFixed(2)
                    : "0"
                }% of pool`
              : "Not deposited yet"
          }
          last
        />
      </div>
    </section>
  );
}

function PoolStat({
  label,
  value,
  sub,
  color,
  last,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "16px 20px",
        borderRight: last ? "none" : "1px solid var(--hairline-soft)",
      }}
    >
      <div className="eyebrow" style={{ fontSize: 9, marginBottom: 6 }}>
        {label}
      </div>
      <div
        className="font-serif font-medium tabular"
        style={{
          fontSize: 22,
          letterSpacing: "-0.025em",
          lineHeight: 1,
          color: color ?? "var(--ink)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="font-mono text-ink-mute tabular"
          style={{ fontSize: 10, marginTop: 6 }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   TRANSACTION HISTORY (real on-chain events for the active wallet)
   ────────────────────────────────────────────────────────── */
function TxHistory() {
  const { address } = useActiveWallet();
  const { events, isLoading, isError } = usePositionEvents(address);

  /// Color lanes for the right-side value column.
  /// - up/down/neutral: borrower flows (borrow = up, repay/liquidated = down,
  ///   collateral pledge/withdraw = neutral).
  /// - lp-deposit (brand blue): LP capital entering the yield position.
  /// - lp-withdraw (amber): LP capital leaving the yield position.
  /// Two distinct hues keep LP rows visually separated from debt rows even
  /// though both involve USDG.
  const COLOR_MAP: Record<
    "up" | "down" | "neutral" | "lp-deposit" | "lp-withdraw",
    string
  > = {
    up: "var(--up)",
    down: "var(--down)",
    neutral: "var(--ink-mute)",
    "lp-deposit": "var(--brand)",
    "lp-withdraw": "var(--amber)",
  };

  return (
    <div style={{ padding: "20px 24px" }}>
      <div className="flex justify-between items-baseline" style={{ marginBottom: 12 }}>
        <div>
          <div className="eyebrow mb-1">Position transactions</div>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 16, letterSpacing: "-0.02em" }}
          >
            Recent vault activity
          </h3>
        </div>
        <span
          className="font-mono text-ink-mute"
          style={{ fontSize: 10 }}
        >
          {events.length} event{events.length === 1 ? "" : "s"} · 24h
        </span>
      </div>

      {!address && (
        <div
          className="font-mono text-ink-mute"
          style={{ fontSize: 11, padding: "12px 0" }}
        >
          Connect wallet to view transaction history.
        </div>
      )}

      {address && isLoading && (
        <div
          className="font-mono text-ink-mute"
          style={{ fontSize: 11, padding: "12px 0" }}
        >
          Scanning vault history…
        </div>
      )}

      {address && isError && (
        <div
          className="font-mono"
          style={{ fontSize: 11, padding: "12px 0", color: "var(--down)" }}
        >
          RPC error — couldn&apos;t fetch event history. Auto-retrying.
        </div>
      )}

      {address && !isLoading && !isError && events.length === 0 && (
        <div
          className="font-mono text-ink-mute"
          style={{ fontSize: 11, padding: "12px 0" }}
        >
          No vault activity in the last 24h for this wallet.
        </div>
      )}

      <div>
        {events.map((e, i) => (
          <div
            key={`${e.txHash}-${i}`}
            className="grid items-center gap-3"
            style={{
              gridTemplateColumns: "90px 1fr auto",
              padding: "10px 0",
              borderBottom:
                i < events.length - 1
                  ? "1px dashed var(--hairline-soft)"
                  : "none",
            }}
          >
            <span
              className="font-mono text-ink-mute"
              style={{ fontSize: 10, letterSpacing: "0.04em" }}
            >
              {relativeTime(e.timestamp)}
            </span>
            <div>
              <div className="text-ink" style={{ fontSize: 12, lineHeight: 1.3 }}>
                {e.label}
              </div>
              <div
                className="font-mono text-ink-mute flex gap-2"
                style={{ fontSize: 10, marginTop: 2 }}
              >
                <a
                  href={explorerTx(e.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="no-underline text-ink-mute hover:text-ink"
                >
                  {shortAddr(e.txHash, 6, 4)}
                </a>
                <span>·</span>
                <span>blk {e.blockNumber.toString()}</span>
              </div>
            </div>
            <span
              className="font-mono tabular font-medium"
              style={{ fontSize: 12, color: COLOR_MAP[e.valueColor] }}
            >
              {e.valueDisplay ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/// Compact "5m ago" / "2h ago" / "Yesterday" / "12 May" rendering for the tx
/// row timestamp. Keeps newest events terse and degrades gracefully for old
/// ones. Pure function so it doesn't trigger re-renders.
function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

/* ──────────────────────────────────────────────────────────────
   HELPERS · Orbit · EmptyState · LegendItem · blended LTV
   ────────────────────────────────────────────────────────── */
function EmptyState() {
  return (
    <div
      className="border-b border-hairline flex flex-col items-center text-center"
      style={{ padding: "48px 32px" }}
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle
          cx="24"
          cy="24"
          r="14"
          stroke="var(--hairline)"
          strokeWidth="1.4"
        />
        <circle
          cx="24"
          cy="24"
          r="22"
          stroke="var(--hairline-soft)"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        <circle cx="24" cy="24" r="6" fill="var(--ink)" />
      </svg>
      <div
        className="font-serif font-medium mt-4"
        style={{ fontSize: 22, letterSpacing: "-0.02em" }}
      >
        No collateral pledged yet.
      </div>
      <div
        className="text-ink-soft mt-2"
        style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 360 }}
      >
        Pledge tokenized stocks via the Markets page to mint a position. It
        will appear here as a live orbital constellation with health factor.
      </div>
      <Link
        href="/markets"
        className="mt-5 px-4 py-2.5 bg-ink text-paper rounded-[2px] no-underline font-medium"
        style={{ fontSize: 13 }}
      >
        Browse markets →
      </Link>
    </div>
  );
}

function blendedLtv(lines: LiveCollateralLine[]): number {
  let total = 0,
    weighted = 0;
  for (const l of lines) {
    const stock = findStock(l.sym);
    total += l.value;
    weighted += l.value * stock.ltv * 10_000;
  }
  return total > 0 ? weighted / total : 7_500;
}
// TODO: read per-asset liqLtvBps from vault instead of assuming +800bps
function blendedLiq(lines: LiveCollateralLine[]): number {
  return blendedLtv(lines) + 800;
}


function LegendItem({
  dot,
  ring,
  label,
  desc,
}: {
  dot?: string;
  ring?: boolean;
  label: string;
  desc: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="rounded-full"
        style={{
          width: 10,
          height: 10,
          background: ring ? "transparent" : dot,
          border: ring ? "1.5px solid var(--ink)" : "none",
        }}
      />
      <div>
        <div className="font-medium" style={{ fontSize: 11 }}>
          {label}
        </div>
        <div
          className="font-mono text-ink-mute"
          style={{ fontSize: 9, letterSpacing: "0.04em" }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}

function Orbit({
  positions,
  tension,
  borrowed,
}: {
  positions: LiveCollateralLine[];
  tension: number;
  borrowed: number;
}) {
  const { vault } = useVaultContext();
  const livePrices = useStockPrices();
  const W = 620,
    H = 380;
  const cx = W / 2,
    cy = H / 2;
  const sorted = [...positions].sort((a, b) => b.weight - a.weight);

  const { data: block } = useBlockNumber({
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    watch: true,
    query: { refetchInterval: 8_000 },
  });

  return (
    <div className="mt-4 relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block">
        <defs>
          <radialGradient id="ef-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--ink)" stopOpacity="1" />
            <stop offset="80%" stopColor="var(--ink)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--ink)" stopOpacity="0.6" />
          </radialGradient>
        </defs>

        {[80, 130, 175].map((r, i) => (
          <circle
            key={r}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--hairline)"
            strokeWidth="1"
            strokeDasharray={i === 2 ? "3 4" : "0"}
          />
        ))}

        {tension > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={175 - tension * 50}
            fill="none"
            stroke="var(--down)"
            strokeWidth="1.2"
            strokeDasharray="6 4"
            opacity={0.5 + tension * 0.4}
          />
        )}

        {sorted.map((p, i) => {
          const r = 80 + i * 50;
          const angle =
            -Math.PI / 2 + (i / sorted.length) * Math.PI * 1.6 - 0.3;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          return (
            <line
              key={p.sym}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="var(--ink)"
              strokeWidth="1.4"
              strokeOpacity={0.4}
            />
          );
        })}

        <g>
          <circle cx={cx} cy={cy} r="46" fill="url(#ef-core)" />
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            fill="var(--paper)"
            fontFamily="Source Serif 4"
            fontSize="14"
            fontWeight="500"
            letterSpacing="-0.02em"
          >
            ${fmt.abbr(borrowed)}
          </text>
          <text
            x={cx}
            y={cy + 11}
            textAnchor="middle"
            fill="var(--paper)"
            fontFamily="JetBrains Mono"
            fontSize="9"
            opacity="0.7"
            letterSpacing="0.06em"
          >
            {vault.borrowSymbol}
          </text>
          <text
            x={cx}
            y={cy + 24}
            textAnchor="middle"
            fill="var(--paper)"
            fontFamily="JetBrains Mono"
            fontSize="8"
            opacity="0.5"
            letterSpacing="0.06em"
          >
            BORROWED
          </text>
          <circle
            cx={cx}
            cy={cy}
            r="46"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="1"
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              animation: "ef-pulse 3.2s ease-out infinite",
            }}
          />
        </g>

        {sorted.map((p, i) => {
          const r = 80 + i * 50;
          const angle =
            -Math.PI / 2 + (i / sorted.length) * Math.PI * 1.6 - 0.3;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          const bodyR = 22 + p.weight * 28;
          const stock = STOCKS.find((s) => s.sym === p.sym);
          const lp = livePrices[p.sym];
          const up = lp?.isLive ? lp.price >= (stock?.price ?? 0) : true;
          const period = stock
            ? (3 + (1 - stock.volatility) * 5).toFixed(1)
            : "4";

          return (
            <g key={p.sym}>
              <g
                style={{
                  transformOrigin: `${x}px ${y}px`,
                  animation: `ef-breathe ${period}s ease-in-out infinite`,
                }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={bodyR}
                  fill="var(--paper)"
                  stroke="var(--ink)"
                  strokeWidth="1.4"
                />
                <circle
                  cx={x}
                  cy={y}
                  r={bodyR - 5}
                  fill="none"
                  stroke={up ? "var(--up)" : "var(--down)"}
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  opacity="0.6"
                />
              </g>
              <text
                x={x}
                y={y - 2}
                textAnchor="middle"
                fontFamily="JetBrains Mono"
                fontSize="11"
                fontWeight="600"
                fill="var(--ink)"
              >
                {p.sym}
              </text>
              <text
                x={x}
                y={y + 11}
                textAnchor="middle"
                fontFamily="JetBrains Mono"
                fontSize="9"
                fill="var(--ink-mute)"
              >
                {fmt.num(p.shares, p.shares < 1 ? 4 : 0)}
              </text>

              <g>
                <line
                  x1={x + bodyR * Math.cos(angle)}
                  y1={y + bodyR * Math.sin(angle)}
                  x2={x + (bodyR + 18) * Math.cos(angle)}
                  y2={y + (bodyR + 18) * Math.sin(angle)}
                  stroke="var(--ink-mute)"
                  strokeWidth="0.7"
                />
                <text
                  x={x + (bodyR + 24) * Math.cos(angle)}
                  y={y + (bodyR + 24) * Math.sin(angle)}
                  fontFamily="Source Serif 4"
                  fontSize="12"
                  fontWeight="500"
                  fill="var(--ink)"
                  textAnchor={Math.cos(angle) >= 0 ? "start" : "end"}
                  letterSpacing="-0.01em"
                >
                  ${fmt.abbr(p.value)}
                </text>
                {stock && (
                  <text
                    x={x + (bodyR + 24) * Math.cos(angle)}
                    y={y + (bodyR + 24) * Math.sin(angle) + 11}
                    fontFamily="JetBrains Mono"
                    fontSize="9"
                    fill={up ? "var(--up)" : "var(--down)"}
                    textAnchor={Math.cos(angle) >= 0 ? "start" : "end"}
                  >
                    {"—"}
                  </text>
                )}
              </g>
            </g>
          );
        })}

        <g>
          <text
            x="16"
            y="20"
            fontFamily="JetBrains Mono"
            fontSize="9"
            fill="var(--ink-mute)"
            letterSpacing="0.1em"
          >
            EQUIFLOW · POSITION-017
          </text>
          <text
            x={W - 16}
            y="20"
            fontFamily="JetBrains Mono"
            fontSize="9"
            fill="var(--ink-mute)"
            letterSpacing="0.1em"
            textAnchor="end"
          >
            ROBINHOOD CHAIN · L3
          </text>
          <text
            x={W - 16}
            y={H - 12}
            fontFamily="JetBrains Mono"
            fontSize="9"
            fill="var(--ink-mute)"
            letterSpacing="0.1em"
            textAnchor="end"
          >
            BLOCK {block !== undefined ? block.toLocaleString("en-US") : "—"}
          </text>
        </g>
      </svg>
    </div>
  );
}

