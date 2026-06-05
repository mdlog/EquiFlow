"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";

type SectionId =
  | "intro"
  | "concepts"
  | "start"
  | "architecture"
  | "faq";

const NAV: Array<{ id: SectionId; label: string; eyebrow: string }> = [
  { id: "intro", label: "Introduction", eyebrow: "01" },
  { id: "concepts", label: "Core concepts", eyebrow: "02" },
  { id: "start", label: "Getting started", eyebrow: "03" },
  { id: "architecture", label: "Architecture", eyebrow: "04" },
  { id: "faq", label: "FAQ", eyebrow: "05" },
];

const CONCEPTS = [
  {
    tag: "PLEDGE",
    title: "Pledge",
    body: "A pledge is a one-way deposit of a tokenized equity (RBN-listed) into the protocol's risk-engine. The token is locked into the user's Smart Account and registered as collateral. Pledges accrue oracle-priced collateral value but never leave the user's address namespace.",
    code: "vault.pledge(token, amount)",
  },
  {
    tag: "VAULT",
    title: "Vault",
    body: "The USDG vault is a singleton ERC-4626-compatible liquidity pool. Lenders deposit USDG, mint vault shares, and earn the borrow APR distributed from the flat 5% borrow APY (net of the 10% reserve factor). Borrowers draw USDG against pledged collateral.",
    code: "vault.borrow(usdg, amount)",
  },
  {
    tag: "USDG",
    title: "USDG stable",
    body: "USDG is a USD-pegged synthetic, over-collateralized by the basket of tokenized equities plus a USDC float of at least 18% of supply. Redeemable 1:1 against the float; arbitrageurs close any peg drift via vault.swap().",
    code: "1 USDG ≈ 1.000 USD",
  },
  {
    tag: "LIQUIDATION",
    title: "Liquidation",
    body: "When a borrower's health factor drops below 1.000, any address may call vault.liquidate(borrower) to repay up to 50% of the debt and seize collateral at a 5% bonus. Gas is sponsored for the first three calls per block to prevent MEV griefing.",
    code: "vault.liquidate(borrower)",
  },
  {
    tag: "ORACLE",
    title: "Oracle",
    body: "Prices come from Pyth Network via a custom PythPriceAdapter contract; on Robinhood Chain testnet the adapter is backed by a wire-compatible MockPyth (no live Hermes/Wormhole feed). The adapter enforces a max staleness of 60 seconds and an explicit confidence-interval check (σ/p ≤ 0.5%). Stale feeds revert the dependent call rather than degrading silently.",
    code: "adapter.getPrice(sym)",
  },
  {
    tag: "HF",
    title: "Health factor",
    body: "HF = (Σ collateral_i × LTV_i) / borrowed_USDG. A position is healthy at HF ≥ 1.000 and callable below it. The UI shades positions amber from 1.000 to 1.250 (\"watch zone\") and red below 1.000.",
    code: "hf = Σ(c·ltv) / borrow",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Connect wallet",
    body: "Click the wallet button (top right) and select an EOA or Smart Account-aware connector. The first connection deploys an ERC-4337 SimpleAccount on demand — paid for by the protocol's paymaster.",
    detail:
      "Robinhood Chain testnet auto-adds itself to the wallet via wagmi's switchChain hook. No manual RPC pasting.",
    code: "connect({ connector: injected() })",
  },
  {
    n: "02",
    title: "Pledge first asset",
    body: "From /markets, click the Pledge button on any listed asset to open the pledge sidebar. Approve the ERC-20 and pledge — both batched into a single UserOp when using the Smart Account flow.",
    detail:
      "Pledged tokens appear in /portfolio with a live oracle valuation. They do not earn vault yield while pledged (that's a separate route).",
    code: "approve + pledge → 1 UserOp",
  },
  {
    n: "03",
    title: "Borrow USDG",
    body: "On the pledge confirmation screen, the LTV slider previews max borrow against the just-pledged collateral. Drawing USDG requires HF ≥ 1.150 at the moment of borrow — a 15% safety buffer above the liquidation threshold.",
    detail:
      "Borrow APR is a flat 5% (borrowApyBps()=500); no interest-rate model is wired on-chain (irm()=0x0), so the rate does not vary with utilization.",
    code: "vault.borrow(amount)",
  },
  {
    n: "04",
    title: "Route to vault",
    body: "Optionally, deposit the borrowed USDG (or excess USDC) into the vault to earn the supply APR. Supply rate = borrow APR × utilization × (1 − reserve factor). Reserve factor is 10% at v0.5.0.",
    detail:
      "Routing is exposed as vault.routeBorrow() — a single call that borrows and deposits, sharing nonce and gas estimation.",
    code: "vault.routeBorrow(usdg)",
  },
  {
    n: "05",
    title: "Manage health factor",
    body: "From /portfolio, top-up collateral or partial-repay to push HF away from 1.000. The repay screen surfaces a \"safe to\" calculator showing the new HF for any repay size.",
    detail:
      "Set an HF alert (browser push, in v0.5) to be notified when an oracle move pushes you below your threshold.",
    code: "vault.repay(amount)",
  },
];

const ARCH_LAYERS = [
  {
    layer: "L1",
    name: "Robinhood Chain",
    role: "Settlement layer · Arbitrum Orbit (Nitro) L3 · 1.2s block target. ETH is the gas token; the protocol holds a fee abstraction paymaster so users transact in USDG.",
    contracts: "Vault · USDG · PythAdapter · Treasury",
  },
  {
    layer: "L2",
    name: "ERC-4337 (Smart Accounts)",
    role: "Every user gets a SimpleAccount on first deposit. Batched transactions, session keys, and recovery via guardians. Bundler is operated by the protocol.",
    contracts: "EntryPoint v0.7 · SimpleAccountFactory",
  },
  {
    layer: "L3",
    name: "EIP-7702",
    role: "For users on regular EOAs, EIP-7702 attaches a delegate to the EOA itself — same UX as Smart Accounts without a separate deployment. The vault recognizes both modes transparently.",
    contracts: "DelegateProxy · EOAValidator",
  },
  {
    layer: "L4",
    name: "Oracle Network",
    role: "Pyth pull oracles for every listed asset. The adapter pulls the latest update from Hermes off-chain, verifies the Wormhole VAA, and writes the price atomically with the dependent vault call.",
    contracts: "PythAdapter · HermesRelay",
  },
  {
    layer: "L5",
    name: "Risk Engine",
    role: "Off-chain keeper that scans Pledged/Borrowed events, recomputes HF on every price tick, and emits liquidatable positions to the public SDK. Decentralized — anyone can run a keeper.",
    contracts: "Keeper SDK · public RPC",
  },
];

const FAQ = [
  {
    q: "Why pledge instead of selling?",
    a: "Pledging keeps your equity exposure intact — you continue to capture upside and dividends — while unlocking liquidity at the borrow APR. Selling triggers a taxable event in most jurisdictions; pledging typically does not.",
  },
  {
    q: "Is USDG a regulated stablecoin?",
    a: "USDG is issued under a Bahamian DARE-act endorsement and is over-collateralized by SEC-registered tokenized equities plus a USDC float of ≥ 18%. It is not yet available to US persons; geo-restrictions are enforced at the front-end and by the protocol's KYC partner.",
  },
  {
    q: "What happens if Pyth goes down?",
    a: "The PythPriceAdapter enforces a 60-second staleness window. If no update lands within that window, all price-dependent calls (borrow, withdraw, liquidate) revert. New pledges and repays still function. The protocol does not silently fall back to a stale price.",
  },
  {
    q: "Can I lose my pledged stock in a liquidation?",
    a: "Yes, partially. A liquidation seizes up to 50% of the debt's worth in collateral plus a 5% bonus — never more. The remaining collateral stays in your account and your borrow is reduced. Repeated liquidations can chain if the price keeps falling.",
  },
  {
    q: "How are LTVs set?",
    a: "Each listed asset gets a max-LTV between 50% (high-vol single names) and 75% (broad ETFs) based on a 30-day realized-vol study and the Pyth confidence-interval. Governance can adjust LTVs through a 5-day timelock.",
  },
  {
    q: "Is there a fee for liquidators?",
    a: "Liquidators receive a 5% bonus on the seized collateral. There is no gas cost for the first three calls per block (paymaster-sponsored) — after that, gas is on the liquidator.",
  },
  {
    q: "What chain is this deployed on?",
    a: "Robinhood Chain testnet (an Arbitrum Orbit / Nitro L3, native ETH gas token). Mainnet is targeted for Q3 2026 pending the final audit cycle.",
  },
  {
    q: "How do I integrate as a liquidator bot?",
    a: "The TypeScript SDK ships with a one-line scanner: liquidators.watch(onLiquidatable). Hook your private RPC, attach a signing wallet with USDG balance, and call vault.liquidate(borrower) on every emission. The /liquidations dashboard is the same SDK in a UI.",
  },
];

export default function DocsPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const wordcount = useMemo(() => {
    const all = [
      ...CONCEPTS.map((c) => c.body),
      ...STEPS.map((s) => s.body + " " + s.detail),
      ...ARCH_LAYERS.map((a) => a.role),
      ...FAQ.map((f) => f.q + " " + f.a),
    ].join(" ");
    return all.split(/\s+/).length;
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="border-b border-ink">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-7 pb-6">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <div className="eyebrow mb-2">
                Documentation · protocol manual · v0.5.0 · last reviewed 29 May 2026
              </div>
              <h1
                className="font-serif font-medium m-0"
                style={{
                  fontSize: 34,
                  letterSpacing: "-0.025em",
                  lineHeight: 1.05,
                  maxWidth: 880,
                }}
              >
                Everything you need to pledge, borrow, and run the protocol.{" "}
                <span className="italic">Start here.</span>
              </h1>
              <p
                className="text-ink-soft mt-2.5 max-w-[660px] m-0"
                style={{ fontSize: 13.5, lineHeight: 1.55 }}
              >
                EquiFlow is a tokenized-equity collateral protocol on Robinhood
                Chain. This document is the canonical user-facing reference for
                the v0.5.0 contracts. For developer SDKs, see the smart-contract
                docs linked at the bottom of the page.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div
                className="font-mono text-ink-mute"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                THIS DOCUMENT
              </div>
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 20, letterSpacing: "-0.02em" }}
              >
                {wordcount.toLocaleString()} words
              </div>
              <div
                className="font-mono text-ink-mute mt-1"
                style={{ fontSize: 10 }}
              >
                ~{Math.ceil(wordcount / 220)} min read
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Inline TOC strip ──────────────────────────────────── */}
      <section className="bg-paper-alt border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-5">
          {NAV.map((n, i) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              className="no-underline text-ink"
              style={{
                padding: "14px 22px",
                borderRight:
                  i < NAV.length - 1
                    ? "1px solid var(--hairline-soft)"
                    : undefined,
              }}
            >
              <div
                className="font-mono text-ink-mute"
                style={{ fontSize: 10, letterSpacing: "0.14em" }}
              >
                {n.eyebrow}
              </div>
              <div
                className="font-serif font-medium mt-1.5"
                style={{ fontSize: 16, letterSpacing: "-0.015em" }}
              >
                {n.label}
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* ── 01 · Introduction ─────────────────────────────────── */}
      <section id="intro" className="border-b border-hairline scroll-mt-20">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-10 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 md:gap-12">
          <div>
            <div className="eyebrow mb-1.5">Section 01</div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 24, letterSpacing: "-0.025em" }}
            >
              Introduction
            </h2>
            <p
              className="text-ink-mute mt-2 m-0"
              style={{ fontSize: 12, lineHeight: 1.5 }}
            >
              What the protocol does, who it's for, and what makes it different
              from a generic lending market.
            </p>
          </div>
          <div className="max-w-[680px]">
            <p
              className="text-ink-soft m-0"
              style={{ fontSize: 14, lineHeight: 1.7 }}
            >
              EquiFlow is a non-custodial protocol that lets holders of
              tokenized public equities pledge those holdings as collateral and
              borrow{" "}
              <span
                className="font-mono"
                style={{
                  background: "var(--paper-alt)",
                  padding: "1px 5px",
                  fontSize: 13,
                }}
              >
                USDG
              </span>
              , a USD-pegged synthetic. The pledge does not transfer ownership —
              the equity remains in the holder's Smart Account and continues to
              accrue any cash dividends — but it is locked in the protocol's
              risk-engine until the borrow is repaid.
            </p>
            <p
              className="text-ink-soft mt-4 m-0"
              style={{ fontSize: 14, lineHeight: 1.7 }}
            >
              The protocol is purpose-built for{" "}
              <strong className="text-ink">three workflows</strong>: unlocking
              spendable liquidity without selling, looping yield against a long
              equity book, and providing a liquid borrow asset (USDG) for the
              broader Robinhood Chain DeFi ecosystem.
            </p>

            <div
              className="grid grid-cols-3 mt-7"
              style={{ border: "1px solid var(--hairline)" }}
            >
              {[
                ["Non-custodial", "Funds live in your Smart Account, never a multisig."],
                ["Single-collateral risk", "Each pledge sits in its own isolated risk slot."],
                ["Pyth-priced", "Oracle pulls with 60s staleness and σ ≤ 0.5% checks."],
              ].map(([title, body], i) => (
                <div
                  key={title}
                  style={{
                    padding: "16px 18px",
                    borderRight:
                      i < 2 ? "1px solid var(--hairline)" : undefined,
                  }}
                >
                  <div
                    className="font-serif font-medium"
                    style={{ fontSize: 14, letterSpacing: "-0.015em" }}
                  >
                    {title}
                  </div>
                  <div
                    className="text-ink-mute mt-1.5"
                    style={{ fontSize: 11.5, lineHeight: 1.5 }}
                  >
                    {body}
                  </div>
                </div>
              ))}
            </div>

            <div
              className="mt-7 p-4"
              style={{
                background: "var(--paper-alt)",
                border: "1px solid var(--hairline)",
                borderLeft: "3px solid var(--ink)",
              }}
            >
              <div className="eyebrow mb-1.5">A note on scope</div>
              <p
                className="text-ink-soft m-0"
                style={{ fontSize: 12.5, lineHeight: 1.6 }}
              >
                EquiFlow does not issue tokenized equities. It accepts a curated
                list of RBN-issued SEC-registered tokens (see /markets). Listing
                a new asset requires a governance vote and a 14-day risk-review
                window. Self-listing is not supported.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 02 · Core concepts ────────────────────────────────── */}
      <section id="concepts" className="border-b border-hairline scroll-mt-20">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-10">
          <div className="flex items-end justify-between gap-6 mb-6 flex-wrap">
            <div>
              <div className="eyebrow mb-1.5">Section 02</div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 26, letterSpacing: "-0.025em" }}
              >
                Core concepts
              </h2>
              <p
                className="text-ink-soft mt-2 m-0 max-w-[640px]"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                Six primitives compose the protocol. Most users only ever
                interact with the first three; the latter three matter when
                you're managing risk or building tooling.
              </p>
            </div>
          </div>

          <div
            className="grid grid-cols-3"
            style={{ border: "1px solid var(--hairline)" }}
          >
            {CONCEPTS.map((c, i) => {
              const row = Math.floor(i / 3);
              const col = i % 3;
              const isLastCol = col === 2;
              const isLastRow = row === Math.floor((CONCEPTS.length - 1) / 3);
              return (
                <div
                  key={c.tag}
                  style={{
                    padding: "22px 24px",
                    borderRight: isLastCol ? undefined : "1px solid var(--hairline)",
                    borderBottom: isLastRow ? undefined : "1px solid var(--hairline)",
                    background: i === 0 ? "var(--paper-alt)" : "var(--paper)",
                  }}
                >
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 9,
                        padding: "3px 7px",
                        background: "var(--ink)",
                        color: "var(--paper)",
                        letterSpacing: "0.1em",
                        fontWeight: 600,
                      }}
                    >
                      {c.tag}
                    </span>
                    <span
                      className="font-mono text-ink-mute"
                      style={{ fontSize: 10 }}
                    >
                      {String(i + 1).padStart(2, "0")} / {CONCEPTS.length}
                    </span>
                  </div>
                  <h3
                    className="font-serif font-medium m-0"
                    style={{ fontSize: 19, letterSpacing: "-0.02em" }}
                  >
                    {c.title}
                  </h3>
                  <p
                    className="text-ink-soft mt-2 m-0"
                    style={{ fontSize: 12.5, lineHeight: 1.6 }}
                  >
                    {c.body}
                  </p>
                  <div
                    className="mt-3.5 font-mono"
                    style={{
                      fontSize: 11,
                      padding: "8px 10px",
                      background: "var(--paper-alt)",
                      borderLeft: "2px solid var(--ink-mute)",
                      color: "var(--ink-soft)",
                    }}
                  >
                    {c.code}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 03 · Getting started ──────────────────────────────── */}
      <section id="start" className="border-b border-hairline scroll-mt-20">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-10">
          <div className="flex items-end justify-between gap-6 mb-6 flex-wrap">
            <div>
              <div className="eyebrow mb-1.5">Section 03</div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 26, letterSpacing: "-0.025em" }}
              >
                Getting started — first <span className="italic">five</span> minutes.
              </h2>
              <p
                className="text-ink-soft mt-2 m-0 max-w-[640px]"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                The end-to-end first-time flow. Each step has a single screen
                in the app; follow the breadcrumbs.
              </p>
            </div>
            <Link
              href="/markets"
              className="font-medium no-underline inline-flex items-center gap-2"
              style={{
                padding: "10px 16px",
                fontSize: 13,
                background: "var(--ink)",
                color: "var(--paper)",
                borderRadius: 2,
              }}
            >
              Open pledge flow
              <span className="font-mono" style={{ fontSize: 10, opacity: 0.7 }}>→</span>
            </Link>
          </div>

          <div style={{ border: "1px solid var(--hairline)" }}>
            {STEPS.map((s, i) => (
              <div
                key={s.n}
                className="grid grid-cols-[120px_1fr_1fr_280px] items-start"
                style={{
                  padding: "22px 24px",
                  borderBottom:
                    i < STEPS.length - 1
                      ? "1px solid var(--hairline-soft)"
                      : undefined,
                  background: i % 2 === 0 ? "var(--paper)" : "var(--paper-alt)",
                }}
              >
                <div
                  className="font-mono"
                  style={{
                    fontSize: 22,
                    letterSpacing: "-0.02em",
                    color: "var(--ink-mute)",
                    fontWeight: 500,
                  }}
                >
                  {s.n}
                </div>
                <div>
                  <h4
                    className="font-serif font-medium m-0"
                    style={{ fontSize: 17, letterSpacing: "-0.02em" }}
                  >
                    {s.title}
                  </h4>
                  <p
                    className="text-ink-soft mt-1.5 m-0"
                    style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 360 }}
                  >
                    {s.body}
                  </p>
                </div>
                <div className="max-w-[260px]">
                  <div
                    className="font-mono text-ink-mute mb-1.5"
                    style={{ fontSize: 9.5, letterSpacing: "0.14em" }}
                  >
                    DETAIL
                  </div>
                  <p
                    className="text-ink-soft m-0"
                    style={{ fontSize: 12, lineHeight: 1.55 }}
                  >
                    {s.detail}
                  </p>
                </div>
                <div className="text-right">
                  <div
                    className="font-mono inline-block"
                    style={{
                      fontSize: 11,
                      padding: "8px 12px",
                      background: "var(--paper)",
                      border: "1px solid var(--hairline)",
                      color: "var(--ink-soft)",
                    }}
                  >
                    {s.code}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 · Architecture ─────────────────────────────────── */}
      <section id="architecture" className="border-b border-hairline scroll-mt-20">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-10">
          <div className="mb-6">
            <div className="eyebrow mb-1.5">Section 04</div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 26, letterSpacing: "-0.025em" }}
            >
              Architecture · the five layers
            </h2>
            <p
              className="text-ink-soft mt-2 m-0 max-w-[680px]"
              style={{ fontSize: 13, lineHeight: 1.55 }}
            >
              EquiFlow lives at the intersection of settlement, account
              abstraction, and oracle infrastructure. Reading the stack
              top-down helps when debugging anomalies.
            </p>
          </div>

          <div
            className="grid grid-cols-[88px_1fr]"
            style={{ border: "1px solid var(--ink)" }}
          >
            {ARCH_LAYERS.map((l, i) => (
              <div key={l.layer} className="contents">
                <div
                  className="font-mono font-medium tabular"
                  style={{
                    padding: "22px 18px",
                    fontSize: 13,
                    background: "var(--ink)",
                    color: "var(--paper)",
                    letterSpacing: "0.1em",
                    borderBottom:
                      i < ARCH_LAYERS.length - 1
                        ? "1px solid var(--paper-alt)"
                        : undefined,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {l.layer}
                </div>
                <div
                  className="grid grid-cols-[1fr_280px]"
                  style={{
                    padding: "22px 24px",
                    background: i % 2 === 0 ? "var(--paper)" : "var(--paper-alt)",
                    borderBottom:
                      i < ARCH_LAYERS.length - 1
                        ? "1px solid var(--hairline-soft)"
                        : undefined,
                    gap: 20,
                  }}
                >
                  <div>
                    <h4
                      className="font-serif font-medium m-0"
                      style={{ fontSize: 16, letterSpacing: "-0.02em" }}
                    >
                      {l.name}
                    </h4>
                    <p
                      className="text-ink-soft mt-1.5 m-0"
                      style={{ fontSize: 12.5, lineHeight: 1.55, maxWidth: 600 }}
                    >
                      {l.role}
                    </p>
                  </div>
                  <div>
                    <div
                      className="font-mono text-ink-mute"
                      style={{ fontSize: 9.5, letterSpacing: "0.14em" }}
                    >
                      CONTRACTS
                    </div>
                    <div
                      className="font-mono mt-1.5"
                      style={{ fontSize: 11.5, color: "var(--ink)" }}
                    >
                      {l.contracts}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <ArchDiagram />
        </div>
      </section>

      {/* ── 05 · FAQ ──────────────────────────────────────────── */}
      <section id="faq" className="border-b border-hairline scroll-mt-20">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-10 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 md:gap-12">
          <div>
            <div className="eyebrow mb-1.5">Section 05</div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 24, letterSpacing: "-0.025em" }}
            >
              Frequently asked
            </h2>
            <p
              className="text-ink-mute mt-2 m-0"
              style={{ fontSize: 12, lineHeight: 1.55 }}
            >
              Questions that come up repeatedly in Discord or in the public
              audit Q&A. If yours isn't here, ask in #docs.
            </p>
          </div>
          <div style={{ border: "1px solid var(--hairline)" }}>
            {FAQ.map((f, i) => {
              const open = openFaq === i;
              return (
                <div
                  key={f.q}
                  style={{
                    borderBottom:
                      i < FAQ.length - 1
                        ? "1px solid var(--hairline-soft)"
                        : undefined,
                  }}
                >
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="w-full text-left flex items-center justify-between gap-4"
                    style={{
                      padding: "16px 20px",
                      background: open ? "var(--paper-alt)" : "var(--paper)",
                      border: "none",
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className="font-mono text-ink-mute tabular"
                        style={{ fontSize: 11, letterSpacing: "0.08em" }}
                      >
                        Q.{String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        className="font-serif font-medium"
                        style={{ fontSize: 15, letterSpacing: "-0.015em" }}
                      >
                        {f.q}
                      </span>
                    </div>
                    <span
                      className="font-mono text-ink-mute"
                      style={{
                        fontSize: 12,
                        transform: open ? "rotate(45deg)" : "none",
                        transition: "transform 0.15s ease",
                      }}
                    >
                      +
                    </span>
                  </button>
                  {open && (
                    <div
                      style={{
                        padding: "0 20px 18px 78px",
                        background: "var(--paper-alt)",
                      }}
                    >
                      <p
                        className="text-ink-soft m-0"
                        style={{ fontSize: 13, lineHeight: 1.65 }}
                      >
                        {f.a}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Footer CTA ────────────────────────────────────────── */}
      <section className="border-t border-ink bg-paper-alt">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-10">
          <div className="grid grid-cols-3 gap-6">
            {[
              {
                title: "Smart contracts",
                body: "Solidity source, deployment addresses, ABIs.",
                cta: "Read contract docs",
              },
              {
                title: "TypeScript SDK",
                body: "viem + wagmi wrappers, liquidator scanner, examples.",
                cta: "Open SDK reference",
              },
              {
                title: "Bug bounty",
                body: "Up to $1.2M for critical findings via Immunefi.",
                cta: "View scope",
              },
            ].map((c) => (
              <div
                key={c.title}
                className="bg-paper"
                style={{
                  padding: "22px 24px",
                  border: "1px solid var(--hairline)",
                }}
              >
                <h4
                  className="font-serif font-medium m-0"
                  style={{ fontSize: 17, letterSpacing: "-0.02em" }}
                >
                  {c.title}
                </h4>
                <p
                  className="text-ink-soft mt-1.5 m-0"
                  style={{ fontSize: 12.5, lineHeight: 1.55 }}
                >
                  {c.body}
                </p>
                <div
                  className="mt-4 font-mono"
                  style={{
                    fontSize: 11,
                    color: "var(--ink)",
                    letterSpacing: "0.06em",
                  }}
                >
                  {c.cta} <span style={{ opacity: 0.6 }}>↗</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

function ArchDiagram() {
  return (
    <div
      className="mt-7"
      style={{
        padding: "24px 28px",
        background: "var(--paper-alt)",
        border: "1px solid var(--hairline)",
      }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <div className="eyebrow">Call graph · pledge → borrow path</div>
        <div className="font-mono text-ink-mute" style={{ fontSize: 10 }}>
          schematic · not to scale
        </div>
      </div>
      <svg viewBox="0 0 980 220" width="100%" style={{ display: "block" }}>
        {[
          { x: 30, label: "Wallet", sub: "EOA / SmartAccount" },
          { x: 220, label: "Bundler", sub: "ERC-4337 EntryPoint" },
          { x: 410, label: "Vault", sub: "borrow / pledge" },
          { x: 600, label: "Pyth Adapter", sub: "verify + write" },
          { x: 790, label: "USDG", sub: "mint to recipient" },
        ].map((n, i, arr) => (
          <g key={n.label}>
            <rect
              x={n.x}
              y={70}
              width={160}
              height={80}
              fill="var(--paper)"
              stroke="var(--ink)"
              strokeWidth="1"
            />
            <text
              x={n.x + 80}
              y={102}
              textAnchor="middle"
              fontFamily="var(--font-serif)"
              fontSize="15"
              fill="var(--ink)"
              fontWeight="500"
            >
              {n.label}
            </text>
            <text
              x={n.x + 80}
              y={122}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="10"
              fill="var(--ink-mute)"
              letterSpacing="0.08em"
            >
              {n.sub}
            </text>
            {i < arr.length - 1 && (
              <g>
                <line
                  x1={n.x + 160}
                  x2={arr[i + 1].x}
                  y1={110}
                  y2={110}
                  stroke="var(--ink-soft)"
                  strokeWidth="1"
                />
                <polygon
                  points={`${arr[i + 1].x - 6},106 ${arr[i + 1].x},110 ${arr[i + 1].x - 6},114`}
                  fill="var(--ink-soft)"
                />
              </g>
            )}
          </g>
        ))}
        <text
          x="490"
          y="30"
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize="10"
          fill="var(--ink-mute)"
          letterSpacing="0.14em"
        >
          USER → SIGNED USEROP → CONTRACT → ORACLE → SETTLEMENT
        </text>
        <text
          x="490"
          y="195"
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize="10"
          fill="var(--ink-mute)"
        >
          atomic · one user signature · one block · revert-on-failure
        </text>
      </svg>
    </div>
  );
}
