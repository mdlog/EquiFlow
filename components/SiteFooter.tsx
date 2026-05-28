"use client";

import Link from "next/link";
import { useBlockNumber } from "wagmi";
import { Wordmark } from "./Wordmark";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";

const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      ["Markets", "/markets"],
      ["Portfolio", "/portfolio"],
      ["Liquidations", "/liquidations"],
      ["Faucet", "/faucet"],
    ],
  },
  {
    title: "Protocol",
    links: [
      ["Docs", "/docs"],
      ["Audits", "/audits"],
      ["Tokenomics", "/tokenomics"],
      ["Governance", "/governance"],
      ["Bug bounty", "/bug-bounty"],
    ],
  },
  {
    title: "Developers",
    links: [
      ["Smart contracts", "/contracts"],
      ["SDK · TypeScript", "/sdk"],
      ["API reference", "/api-reference"],
      ["GitHub", "#"],
    ],
  },
  {
    title: "Community",
    links: [
      ["Discord", "#"],
      ["Mirror", "#"],
      ["Twitter / X", "#"],
      ["Telegram", "#"],
    ],
  },
];

export function SiteFooter({ gap = true }: { gap?: boolean } = {}) {
  const { data: block } = useBlockNumber({
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    watch: true,
    query: { refetchInterval: 8_000 },
  });
  const live = block !== undefined;
  const blockLabel = live
    ? `BLOCK ${block.toLocaleString("en-US")}`
    : "BLOCK 42,917,406";

  return (
    <footer
      className="bg-paper-alt border-t border-ink pt-12 sm:pt-16 pb-8 sm:pb-9"
      style={{ marginTop: gap ? 40 : 0 }}
    >
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8">
        <div className="grid gap-12 grid-cols-2 md:grid-cols-3 lg:[grid-template-columns:1.6fr_repeat(4,1fr)]">
          <div className="col-span-2 lg:col-span-1">
            <Wordmark size={16} />
            <p
              className="text-ink-soft m-0"
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                marginTop: 16,
                maxWidth: 320,
              }}
            >
              Yield-generating stock collateralization on Robinhood Chain.
              Pledge tokenized equities, borrow regulated stables, route to
              yield — without selling a share.
            </p>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h4
                className="text-ink-mute uppercase font-medium m-0"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  marginBottom: 14,
                }}
              >
                {c.title}
              </h4>
              <ul
                className="list-none p-0 m-0 flex flex-col"
                style={{ gap: 9 }}
              >
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className="no-underline text-ink-soft hover:text-ink"
                      style={{ fontSize: 13 }}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="mt-14 pt-5 flex flex-col sm:flex-row justify-between sm:items-center font-mono text-ink-mute gap-2"
          style={{
            borderTop: "1px solid var(--hairline)",
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          <div className="flex gap-[18px] items-center flex-wrap">
            <span>EQUIFLOW LABS · 2026</span>
            <span>·</span>
            <span>{`v${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.5.0"} · BUILD ${process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) ?? "dev"}`}</span>
            <span>·</span>
            <span title="Audit rounds completed">AUDIT v7</span>
          </div>
          <div className="flex gap-[18px] items-center flex-wrap">
            <span>{blockLabel}</span>
            <span>·</span>
            <span className="inline-flex items-center">
              <span
                className={`rounded-full mr-1.5 inline-block ${live ? "bg-up" : "bg-ink-mute"}`}
                style={{
                  width: 6,
                  height: 6,
                  animation: live
                    ? "ef-breathe 2.2s ease-in-out infinite"
                    : undefined,
                }}
              />
              {live ? "ALL SYSTEMS NOMINAL" : "OFFLINE · DEMO"}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
