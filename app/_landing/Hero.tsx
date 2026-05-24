import Link from "next/link";
import { HeroOrbit } from "@/components/HeroOrbit";
import { Arrow } from "./shared";

export function Hero() {
  return (
    <section
      className="border-b border-hairline"
      style={{ padding: "64px 0 56px" }}
    >
      <div className="max-w-[1320px] mx-auto px-8 grid gap-20 items-center grid-cols-1 lg:[grid-template-columns:1.15fr_1fr]">
        <div>
          <div
            className="inline-flex items-center gap-3 bg-paper-alt border border-hairline-soft rounded-[2px] mb-7"
            style={{ padding: "5px 11px 5px 8px" }}
          >
            <span
              className="rounded-full"
              style={{ width: 6, height: 6, background: "var(--amber)" }}
            />
            <span
              className="font-mono text-ink-soft"
              style={{ fontSize: 11, letterSpacing: "0.06em" }}
            >
              YIELD-GENERATING STOCK COLLATERAL · LIVE ON ROBINHOOD CHAIN
            </span>
          </div>

          <h1
            className="font-serif font-medium m-0"
            style={{
              fontSize: "clamp(36px, 4.4vw, 64px)",
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
            }}
          >
            Your tokenized stocks shouldn&apos;t <em>sit idle</em>. Put them to
            work — without selling a share.
          </h1>

          <p
            className="max-w-[520px] mt-7 text-ink-soft"
            style={{ fontSize: 16, lineHeight: 1.6 }}
          >
            Over 2,000 US equities and ETPs are tokenized on Arbitrum, but they
            generate no yield beyond price drift.{" "}
            <strong className="text-ink font-medium">EquiFlow</strong> turns
            those holdings into productive collateral: pledge AAPL or SPY,
            borrow regulated stablecoins, and route the proceeds into Aave V3.{" "}
            <strong className="text-ink font-medium">One signature.</strong>{" "}
            <strong className="text-ink font-medium">Sponsored gas.</strong>{" "}
            <strong className="text-ink font-medium">No taxable sale.</strong>
          </p>

          <div className="mt-8 flex flex-wrap gap-3 items-center">
            <Link href="/pledge" className="btn-primary">
              Open pledge flow
              <Arrow />
            </Link>
            <Link href="/markets" className="btn-ghost">
              Browse markets
            </Link>
          </div>

          <div
            className="mt-8 pt-6 flex gap-6 flex-wrap"
            style={{ borderTop: "1px dashed var(--hairline)" }}
          >
            {[
              ["Audits", "Pending"],
              ["Chain", "Robinhood L3 · settled on Arbitrum"],
              ["Oracle", "Pyth Network · 24/5 multi-session"],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <span
                  className="text-ink-mute uppercase"
                  style={{ fontSize: 10, letterSpacing: "0.14em" }}
                >
                  {k}
                </span>
                <span className="font-mono" style={{ fontSize: 12 }}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>

        <HeroOrbit />
      </div>
    </section>
  );
}
