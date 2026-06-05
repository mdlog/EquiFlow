"use client";

import Link from "next/link";
import { AssetLogo } from "@/components/AssetLogo";
import { fmt } from "@/lib/format";
import { STOCKS } from "@/lib/config/stocks";
import { SectionHead } from "./shared";
import { useListedAssets, useProtocolStats } from "@/lib/hooks/use-protocol-stats";
import { useMarkets24h } from "@/lib/hooks/use-market-history";
import { useStockPrice } from "@/lib/hooks/use-adapter-price";

export function SupportedAssets() {
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  const h24 = useMarkets24h(STOCKS.map((s) => s.sym));

  // Borrow APR / Vault APR / Liquidity are vault-wide — a single borrow vault
  // backs every collateral — so the same figure shows on each row, matching
  // how /markets surfaces them. Null while the on-chain read is in flight.
  const borrowApr = stats.derived ? stats.derived.borrowAprBps / 100 : null;
  const vaultApr = stats.derived ? stats.derived.supplyAprBps / 100 : null;
  const liquidityUsd =
    stats.liquidityUsd != null ? Number(stats.liquidityUsd) / 1e18 : null;

  return (
    <section className="border-b border-hairline py-12 sm:py-20">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8">
        <SectionHead
          eyebrow={`Supported assets · ${STOCKS.length} tokenized equities`}
          title="Pledge any of these."
          titleEm="More coming."
          right="LIVE PRICES · TESTNET"
        />

        <div className="overflow-x-auto">
          <table
            className="w-full text-[13px]"
            style={{ borderCollapse: "collapse" }}
          >
            <thead>
              <tr>
                {[
                  "Asset",
                  "Last price",
                  "24h",
                  "Max LTV",
                  "Borrow APR",
                  "Vault APR",
                  "Liquidity",
                  "",
                ].map((h, i) => (
                  <th
                    key={i}
                    className="text-ink-mute uppercase font-medium"
                    style={{
                      padding: "12px 16px",
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      borderBottom: "1px solid var(--ink)",
                      textAlign: i === 0 || i === 3 ? "left" : "right",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STOCKS.map((s) => (
                <AssetRow
                  key={s.sym}
                  sym={s.sym}
                  name={s.name}
                  sector={s.sector}
                  seedPrice={s.price}
                  ltv={s.ltv}
                  change24h={h24.data?.[s.sym]?.changePct ?? null}
                  borrowApr={borrowApr}
                  vaultApr={vaultApr}
                  liquidityUsd={liquidityUsd}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

interface AssetRowProps {
  sym: string;
  name: string;
  sector: string;
  seedPrice: number;
  ltv: number;
  change24h: number | null;
  borrowApr: number | null;
  vaultApr: number | null;
  liquidityUsd: number | null;
}

function AssetRow({
  sym,
  name,
  sector,
  seedPrice,
  ltv,
  change24h,
  borrowApr,
  vaultApr,
  liquidityUsd,
}: AssetRowProps) {
  // Live on-chain price; falls back to the seed reference price while the
  // adapter read resolves (useStockPrice never returns null — it defaults to
  // the config seed) so the column is always populated.
  const { price } = useStockPrice(sym);
  const ltvPct = Math.round(ltv * 100);
  const has24h = change24h != null;
  const up24h = (change24h ?? 0) >= 0;

  return (
    <tr
      className="hover:bg-paper-alt transition-colors"
      style={{ borderBottom: "1px solid var(--hairline-soft)" }}
    >
      <td style={{ padding: 16 }}>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center"
            style={{
              width: 36,
              height: 36,
              border: "1px solid var(--ink)",
              background: "var(--paper)",
            }}
          >
            <AssetLogo sym={sym} size={24} />
          </div>
          <div>
            <div className="font-mono font-semibold" style={{ fontSize: 13 }}>
              {sym}
            </div>
            <div className="text-ink-mute" style={{ fontSize: 11, marginTop: 2 }}>
              {name} · {sector}
            </div>
          </div>
        </div>
      </td>
      <td className="text-right font-mono tabular" style={{ padding: 16 }}>
        {fmt.usd(price ?? seedPrice)}
      </td>
      <td
        className="text-right font-mono tabular"
        style={{
          padding: 16,
          color: has24h
            ? up24h
              ? "var(--up)"
              : "var(--down)"
            : "var(--ink-mute)",
        }}
      >
        {has24h ? fmt.signedPct(change24h as number, 2) : "—"}
      </td>
      <td style={{ padding: 16 }}>
        <div className="font-mono tabular">{ltvPct}%</div>
        <div
          className="mt-1.5"
          style={{ height: 3, background: "var(--paper-deep)" }}
        >
          <div
            style={{ height: "100%", width: `${ltvPct}%`, background: "var(--ink)" }}
          />
        </div>
      </td>
      <td className="text-right font-mono tabular" style={{ padding: 16 }}>
        {borrowApr != null ? `${borrowApr.toFixed(2)}%` : "—"}
      </td>
      <td
        className="text-right font-mono tabular text-up"
        style={{ padding: 16 }}
      >
        {vaultApr != null ? `+${vaultApr.toFixed(2)}%` : "—"}
      </td>
      <td className="text-right font-mono tabular" style={{ padding: 16 }}>
        {liquidityUsd != null ? fmt.usd(liquidityUsd, 2) : "—"}
      </td>
      <td className="text-right" style={{ padding: 16 }}>
        <Link href={`/markets/${sym}`} className="btn-ghost btn-sm">
          View
        </Link>
      </td>
    </tr>
  );
}
