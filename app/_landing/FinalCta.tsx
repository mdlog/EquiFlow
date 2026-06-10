"use client";

import { useState } from "react";
import Link from "next/link";
import { Arrow } from "./shared";
import { AssetLogo } from "@/components/AssetLogo";
import { useStockPrice } from "@/lib/hooks/use-adapter-price";
import { STOCKS } from "@/lib/config/stocks";
import { useListedAssets, useProtocolStats } from "@/lib/hooks/use-protocol-stats";
import { fmt } from "@/lib/format";

const LIVE_STOCKS = STOCKS.filter((s) => s.liveOnRBN);

const stepperBtn: React.CSSProperties = {
  width: 22,
  height: 22,
  lineHeight: 1,
  border: "1px solid rgba(250,248,242,.3)",
  borderRadius: 2,
  background: "transparent",
  color: "var(--paper)",
  cursor: "pointer",
};

export function FinalCta() {
  // Mini borrow calculator — pick an asset, set a share count, every number
  // below reacts. Price AND LTV come from the live on-chain read (config
  // fallback), the borrow rate from the vault — nothing here is hardcoded.
  const [sym, setSym] = useState("TSLA");
  const [shares, setShares] = useState(100);
  const { price, ltv } = useStockPrice(sym);
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);

  const collateral = price * shares;
  const maxBorrow = collateral * ltv;
  const borrowApr = stats.derived
    ? `${(stats.derived.borrowAprBps / 100).toFixed(2)}% APR`
    : "—";

  const rows: Array<[string, string, string?]> = [
    ["Share price · live", fmt.usd(price, 2)],
    ["Collateral value", fmt.usd(collateral, 0)],
    [`Max borrow (${(ltv * 100).toFixed(0)}% LTV)`, fmt.usd(maxBorrow, 0)],
    ["Borrow rate · live", borrowApr],
    ["Signatures · gas you pay", "1 · $0.00"],
  ];

  return (
    <section
      className="py-16 sm:py-24"
      style={{
        background: "var(--ink)",
        color: "var(--paper)",
      }}
    >
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 grid items-center grid-cols-1 lg:[grid-template-columns:1.4fr_1fr] gap-12 lg:gap-16">
        <div>
          <div
            className="uppercase"
            style={{
              fontSize: 10,
              letterSpacing: "0.16em",
              color: "rgba(250,248,242,.55)",
              fontWeight: 500,
              marginBottom: 20,
            }}
          >
            Ready when you are
          </div>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: "clamp(28px, 5vw, 52px)", letterSpacing: "-0.035em", lineHeight: 1.02 }}
          >
            Pledge a single share.
            <br />
            Borrow <em>without selling</em>.
          </h2>
          <p
            style={{
              marginTop: 20,
              fontSize: 16,
              lineHeight: 1.55,
              color: "rgba(250,248,242,.7)",
              maxWidth: 520,
            }}
          >
            The pledge flow takes one click and one signature. Gas is on us. You
            can unwind any time — your shares stay yours. Borrows settle during
            US market sessions; deposits anytime.
          </p>
          <div className="mt-7 flex gap-3 flex-wrap">
            <Link
              href={`/markets/${sym}`}
              className="btn-on-dark-primary btn-primary"
            >
              Pledge your first share
              <Arrow />
            </Link>
            <Link href="/faucet" className="btn-on-dark-ghost btn-ghost">
              Get test tokens
            </Link>
          </div>
        </div>

        <div
          className="rounded-[2px]"
          style={{ padding: 24, border: "1px solid rgba(250,248,242,.18)" }}
        >
          <div className="flex flex-wrap gap-2" style={{ marginBottom: 16 }}>
            {LIVE_STOCKS.map((s) => {
              const sel = s.sym === sym;
              return (
                <button
                  key={s.sym}
                  type="button"
                  onClick={() => setSym(s.sym)}
                  aria-pressed={sel}
                  className="font-mono inline-flex items-center gap-1.5"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    padding: "4px 9px 4px 5px",
                    borderRadius: 2,
                    cursor: "pointer",
                    border: sel
                      ? "1px solid rgba(250,248,242,.85)"
                      : "1px solid rgba(250,248,242,.25)",
                    background: sel ? "rgba(250,248,242,.12)" : "transparent",
                    color: sel ? "var(--paper)" : "rgba(250,248,242,.65)",
                  }}
                >
                  <span
                    className="flex items-center justify-center bg-white overflow-hidden rounded-full"
                    style={{ width: 18, height: 18 }}
                  >
                    <AssetLogo sym={s.sym} size={14} rounded />
                  </span>
                  {s.sym}
                </button>
              );
            })}
          </div>

          <div
            className="flex items-center justify-between flex-wrap gap-2"
            style={{ marginBottom: 14 }}
          >
            <span
              className="font-mono uppercase"
              style={{
                fontSize: 10,
                letterSpacing: "0.14em",
                color: "rgba(250,248,242,.55)",
              }}
            >
              Try it · live prices
            </span>
            <span
              className="font-mono inline-flex items-center gap-2"
              style={{ fontSize: 11 }}
            >
              <button
                type="button"
                onClick={() => setShares((n) => Math.max(10, n - 10))}
                aria-label="Fewer shares"
                style={stepperBtn}
              >
                −
              </button>
              <span className="tabular" style={{ minWidth: 76, textAlign: "center" }}>
                {shares} shares
              </span>
              <button
                type="button"
                onClick={() => setShares((n) => Math.min(1000, n + 10))}
                aria-label="More shares"
                style={stepperBtn}
              >
                +
              </button>
            </span>
          </div>
          {rows.map(([k, v, color], i, arr) => (
            <div
              key={k}
              className="flex justify-between items-baseline"
              style={{
                padding: "14px 0",
                borderBottom:
                  i === arr.length - 1
                    ? "none"
                    : "1px solid rgba(250,248,242,.1)",
              }}
            >
              <span style={{ fontSize: 13, color: "rgba(250,248,242,.7)" }}>
                {k}
              </span>
              <span
                className="font-mono font-medium"
                style={{ fontSize: 13, color: color ?? "var(--paper)" }}
              >
                {v}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
