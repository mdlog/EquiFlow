"use client";

import Link from "next/link";
import { Arrow } from "./shared";
import { useStockPrice } from "@/lib/hooks/use-adapter-price";
import { useListedAssets, useProtocolStats } from "@/lib/hooks/use-protocol-stats";
import { findStock } from "@/lib/config/stocks";
import { fmt } from "@/lib/format";

export function FinalCta() {
  const sym = "AAPL";
  const shares = 100;
  const stock = findStock(sym);
  const { price } = useStockPrice(sym);
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);

  const collateral = price * shares;
  const ltv = stock.ltv;
  const maxBorrow = collateral * ltv;
  const vaultApr = stats.derived ? stats.derived.supplyAprBps / 10_000 : 0;
  const borrowApr = stats.derived ? stats.derived.borrowAprBps / 10_000 : 0;
  const netApr = vaultApr - borrowApr;
  const yearlyNet = maxBorrow * netApr;

  const rows: Array<[string, string, string?]> = [
    ["Collateral value", fmt.usd(collateral, 0)],
    [`Max borrow (${(ltv * 100).toFixed(0)}% LTV)`, fmt.usd(maxBorrow, 0)],
    [
      "Net APR if routed to vault",
      stats.derived ? fmt.pct(netApr * 100, 2, true) : "loading…",
      netApr > 0 ? "var(--up)" : undefined,
    ],
    ["Estimated net / year", stats.derived ? fmt.usd(yearlyNet, 0) : "—"],
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
            Watch it <em>start earning</em>.
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
            can unwind any time — your shares stay yours.
          </p>
          <div className="mt-7 flex gap-3 flex-wrap">
            <Link href="/markets" className="btn-on-dark-primary btn-primary">
              Explore markets
              <Arrow />
            </Link>
            <Link href="/portfolio" className="btn-on-dark-ghost btn-ghost">
              View portfolio
            </Link>
          </div>
        </div>

        <div
          className="rounded-[2px]"
          style={{ padding: 24, border: "1px solid rgba(250,248,242,.18)" }}
        >
          <div
            className="font-mono uppercase"
            style={{
              fontSize: 10,
              letterSpacing: "0.14em",
              color: "rgba(250,248,242,.55)",
              marginBottom: 14,
            }}
          >
            Example · {shares} {sym} @ {fmt.usd(price, 2)}
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
