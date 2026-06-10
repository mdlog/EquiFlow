import Link from "next/link";
import { HeroOrbit } from "@/components/HeroOrbit";
import { Arrow } from "./shared";
import { OracleStatus } from "./OracleStatus";

export function Hero() {
  return (
    <section
      className="border-b border-hairline py-10 sm:py-16"
    >
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 grid gap-10 lg:gap-20 items-center grid-cols-1 lg:[grid-template-columns:1.15fr_1fr]">
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
              THE FIRST LENDING MARKET FOR TOKENIZED US EQUITIES · LIVE ON
              ROBINHOOD CHAIN
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
            Don&apos;t sell your stocks. <em>Make them work.</em>
          </h1>

          <p
            className="max-w-[520px] mt-7 text-ink-soft"
            style={{ fontSize: 16, lineHeight: 1.6 }}
          >
            Over 2,000 US equities and ETPs are tokenized on Arbitrum, but they
            generate no yield beyond price drift.{" "}
            <strong className="text-ink font-medium">EquiFlow</strong> turns
            those holdings into productive collateral: pledge TSLA or AMD and
            borrow regulated stablecoins against them — without selling a share.{" "}
            <strong className="text-ink font-medium">One signature.</strong>{" "}
            <strong className="text-ink font-medium">Sponsored gas.</strong>{" "}
            <strong className="text-ink font-medium">No taxable sale.</strong>
          </p>

          <div className="mt-8 flex flex-wrap gap-3 items-center">
            <Link href="/markets" className="btn-primary">
              Explore markets
              <Arrow />
            </Link>
            <Link href="/faucet" className="btn-ghost">
              Get test tokens
            </Link>
          </div>

          <div
            className="mt-8 pt-6 flex gap-6 flex-wrap"
            style={{ borderTop: "1px dashed var(--hairline)" }}
          >
            {(
              [
                {
                  k: "Security",
                  v: "169 Foundry tests · internal audit · 3rd-party pending",
                  href: "/audits",
                },
                { k: "Chain", v: "Robinhood L3 · settled on Arbitrum" },
                { k: "Oracle", v: <OracleStatus /> },
              ] as { k: string; v: React.ReactNode; href?: string }[]
            ).map(({ k, v, href }) => {
              const cell = (
                <div className="flex flex-col gap-0.5">
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
              );
              return href ? (
                <Link
                  key={k}
                  href={href}
                  className="no-underline text-ink hover:text-ink-soft"
                >
                  {cell}
                </Link>
              ) : (
                <div key={k}>{cell}</div>
              );
            })}
          </div>
        </div>

        <HeroOrbit />
      </div>
    </section>
  );
}
