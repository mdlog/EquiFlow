"use client";

import { useMemo, useState } from "react";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";

type Allocation = {
  key: string;
  label: string;
  pct: number;
  amount: number;
  cliff: string;
  vesting: string;
  color: string;
  note: string;
};

const SUPPLY = 100_000_000;

const ALLOC: Allocation[] = [
  {
    key: "community",
    label: "Community & ecosystem",
    pct: 38,
    amount: 38_000_000,
    cliff: "none",
    vesting: "60m linear · usage-gated",
    color: "var(--ink)",
    note: "Released against on-chain protocol usage (TVL milestones, borrower count). Unclaimed tokens roll into a perpetual emissions reservoir governed by the DAO.",
  },
  {
    key: "treasury",
    label: "Protocol treasury",
    pct: 22,
    amount: 22_000_000,
    cliff: "12m",
    vesting: "48m linear",
    color: "var(--ink-soft)",
    note: "Multi-sig treasury controlled by the EquiFlow Foundation. Funds audits, insurance reserves, listing incentives, and grants. Spend reports published quarterly.",
  },
  {
    key: "team",
    label: "Core team",
    pct: 18,
    amount: 18_000_000,
    cliff: "12m",
    vesting: "36m linear (after cliff)",
    color: "var(--amber)",
    note: "Allocated to active contributors with a one-year cliff and three-year linear vest. Leavers forfeit unvested portions back to the treasury.",
  },
  {
    key: "investors",
    label: "Strategic investors",
    pct: 14,
    amount: 14_000_000,
    cliff: "12m",
    vesting: "30m linear (after cliff)",
    color: "var(--ink-mute)",
    note: "Seed + Series-A round at $0.085 and $0.42 respectively. Cliff and vesting are enforced on-chain via a Sablier-style stream; no off-chain SAFT side-letters.",
  },
  {
    key: "airdrop",
    label: "Genesis airdrop",
    pct: 8,
    amount: 8_000_000,
    cliff: "none",
    vesting: "6m linear claim window",
    color: "var(--up)",
    note: "Snapshot taken on testnet pledgers (32k addresses), liquidators (5.4k), early USDG holders. Quadratic adjustment caps any single wallet at 0.15% of supply.",
  },
];

const UTILITIES = [
  {
    n: "01",
    tag: "GOV",
    title: "Governance",
    body: "1 EQUI = 1 vote on parameter changes (LTV, IRM slopes, listing). 5-day timelock between vote and execution. Quorum is 4% of circulating supply.",
  },
  {
    n: "02",
    tag: "FEE",
    title: "Fee discount",
    body: "Stake EQUI to reduce borrow-origination fee from 10 bps to 4 bps. Stake requirement scales with cumulative borrow notional. Lockup is 30 days.",
  },
  {
    n: "03",
    tag: "LIQ",
    title: "Liquidator boost",
    body: "Stakers above tier 2 (≥ 50k EQUI) receive +1.5% bonus on liquidations on top of the standard 5%. Funded from the treasury's incentives line.",
  },
  {
    n: "04",
    tag: "STAKE",
    title: "Staking yield",
    body: "Stakers earn a share of protocol fees — 30% of borrow-interest distribution and 100% of liquidation-penalty residuals. Auto-compounded into the stake.",
  },
];

const EMISSIONS_YEARS = [
  { y: 0, label: "Year 0", emitted: 0, circulating: 8_000_000 },
  { y: 1, label: "Year 1", emitted: 11_200_000, circulating: 19_200_000 },
  { y: 2, label: "Year 2", emitted: 23_600_000, circulating: 42_800_000 },
  { y: 3, label: "Year 3", emitted: 34_100_000, circulating: 76_900_000 },
  { y: 4, label: "Year 4", emitted: 23_100_000, circulating: 100_000_000 },
];

const USDG_STATS = [
  { label: "Circulating supply", value: "$42.8M", sub: "USDG · on-chain" },
  { label: "Backing ratio", value: "163%", sub: "collateral / debt" },
  { label: "USDC float", value: "$7.7M", sub: "18.0% of supply" },
  { label: "Peg deviation · 30d", value: "±0.06%", sub: "max observed" },
];

export default function TokenomicsPage() {
  const [activeAlloc, setActiveAlloc] = useState<string>("community");

  const allocActive = useMemo(
    () => ALLOC.find((a) => a.key === activeAlloc) ?? ALLOC[0],
    [activeAlloc],
  );

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav />

      <div
        className="border-b border-hairline-soft"
        style={{ padding: "12px 32px", background: "var(--amber-soft)" }}
      >
        <span style={{ fontSize: 12, letterSpacing: "0.06em" }} className="text-ink-soft font-mono uppercase">
          ILLUSTRATIVE · Token distribution data is illustrative and does not represent actual allocations.
        </span>
      </div>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="border-b border-ink">
        <div className="max-w-[1320px] mx-auto px-8 pt-7 pb-6">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <div className="eyebrow mb-2">
                Tokenomics · two tokens · v0.4.2 economic spec · last update May 2026
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
                Two tokens, one protocol. <span className="italic">EQUI</span> governs;{" "}
                <span className="italic">USDG</span> circulates.
              </h1>
              <p
                className="text-ink-soft mt-2.5 max-w-[660px] m-0"
                style={{ fontSize: 13.5, lineHeight: 1.55 }}
              >
                EQUI is a fixed-supply governance token with utility staking.
                USDG is the over-collateralized USD synthetic borrowers draw
                against pledged equities. Their issuance models are
                deliberately decoupled.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div
                className="font-mono text-ink-mute"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                EQUI TOTAL SUPPLY
              </div>
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 28, letterSpacing: "-0.02em" }}
              >
                100,000,000
              </div>
              <div
                className="font-mono text-ink-mute mt-1"
                style={{ fontSize: 10 }}
              >
                fixed · no inflation past Y4
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── EQUI section header ──────────────────────────────── */}
      <section className="bg-paper-alt border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-8 py-6 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-5">
            <div
              className="font-mono font-medium"
              style={{
                fontSize: 12,
                padding: "5px 12px",
                background: "var(--ink)",
                color: "var(--paper)",
                letterSpacing: "0.14em",
              }}
            >
              TOKEN 01 · EQUI
            </div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Governance & protocol utility
            </h2>
          </div>
          <div className="flex gap-5">
            {[
              ["Supply", "100M"],
              ["Standard", "ERC-20"],
              ["Chain", "Robinhood"],
              ["Status", "TGE Q3 2026"],
            ].map(([k, v]) => (
              <div key={k}>
                <div
                  className="font-mono text-ink-mute"
                  style={{ fontSize: 9.5, letterSpacing: "0.14em" }}
                >
                  {k.toUpperCase()}
                </div>
                <div
                  className="font-mono font-medium mt-1"
                  style={{ fontSize: 13, letterSpacing: "0.04em" }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Distribution donut + breakdown ────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-[1fr_1.2fr]">
          <div
            style={{
              padding: "26px 28px",
              borderRight: "1px solid var(--hairline)",
            }}
          >
            <div className="eyebrow mb-1.5">Distribution</div>
            <h3
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              How the 100M splits
            </h3>
            <p
              className="text-ink-mute mt-2 m-0"
              style={{ fontSize: 12, lineHeight: 1.55, maxWidth: 360 }}
            >
              Click a slice or row to inspect cliff, vesting curve, and intent.
              Hover the donut to highlight.
            </p>
            <Donut
              alloc={ALLOC}
              activeKey={activeAlloc}
              onSelect={setActiveAlloc}
            />
            <div
              className="mt-5"
              style={{
                padding: "12px 14px",
                background: "var(--paper-alt)",
                border: "1px solid var(--hairline)",
                borderLeft: "3px solid " + allocActive.color,
              }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div
                  className="font-mono font-medium"
                  style={{ fontSize: 11, letterSpacing: "0.1em" }}
                >
                  {allocActive.label.toUpperCase()}
                </div>
                <div
                  className="font-serif font-medium tabular"
                  style={{ fontSize: 18, letterSpacing: "-0.02em" }}
                >
                  {allocActive.pct}%
                </div>
              </div>
              <p
                className="text-ink-soft m-0"
                style={{ fontSize: 12, lineHeight: 1.55 }}
              >
                {allocActive.note}
              </p>
            </div>
          </div>

          <div style={{ padding: "26px 28px" }}>
            <div className="eyebrow mb-3">Cohort breakdown</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--ink)" }}>
                  <Th>Cohort</Th>
                  <Th align="right">Tokens</Th>
                  <Th align="right">% of supply</Th>
                  <Th>Cliff</Th>
                  <Th>Vesting</Th>
                </tr>
              </thead>
              <tbody>
                {ALLOC.map((a) => {
                  const isActive = a.key === activeAlloc;
                  return (
                    <tr
                      key={a.key}
                      onClick={() => setActiveAlloc(a.key)}
                      style={{
                        borderBottom: "1px dashed var(--hairline-soft)",
                        background: isActive ? "var(--paper-alt)" : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "14px 10px" }}>
                        <div className="flex items-center gap-2.5">
                          <span
                            className="inline-block"
                            style={{ width: 10, height: 10, background: a.color }}
                          />
                          <div>
                            <div
                              className="font-serif font-medium"
                              style={{ fontSize: 14, letterSpacing: "-0.015em" }}
                            >
                              {a.label}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td
                        style={{ padding: "14px 10px", textAlign: "right" }}
                        className="font-mono tabular font-medium"
                      >
                        {(a.amount / 1_000_000).toFixed(1)}M
                      </td>
                      <td
                        style={{ padding: "14px 10px", textAlign: "right" }}
                        className="font-serif font-medium tabular"
                      >
                        <span style={{ fontSize: 16, letterSpacing: "-0.02em" }}>
                          {a.pct}%
                        </span>
                      </td>
                      <td
                        style={{ padding: "14px 10px" }}
                        className="font-mono"
                      >
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 7px",
                            background:
                              a.cliff === "none" ? "var(--up-soft)" : "var(--paper-alt)",
                            color: a.cliff === "none" ? "var(--up)" : "var(--ink-soft)",
                            border: `1px solid ${a.cliff === "none" ? "var(--up)" : "var(--hairline)"}`,
                          }}
                        >
                          {a.cliff}
                        </span>
                      </td>
                      <td
                        style={{ padding: "14px 10px", fontSize: 12 }}
                        className="text-ink-soft"
                      >
                        {a.vesting}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Vesting timeline (stacked area) ────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-8 py-9">
          <div className="flex justify-between items-end mb-5 flex-wrap gap-4">
            <div>
              <div className="eyebrow mb-1.5">Vesting timeline</div>
              <h3
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Circulating supply across <span className="italic">five years</span>
              </h3>
              <p
                className="text-ink-soft mt-2 m-0 max-w-[640px]"
                style={{ fontSize: 12.5, lineHeight: 1.55 }}
              >
                Stacked by cohort. Cliffs show as flat plateaus; the steep Y1→Y2
                ramp is the airdrop claim window unlocking with the start of
                ecosystem emissions.
              </p>
            </div>
            <div className="flex gap-4 flex-wrap">
              {ALLOC.map((a) => (
                <div
                  key={a.key}
                  className="flex items-center gap-1.5"
                  style={{ fontSize: 11 }}
                >
                  <span
                    className="inline-block"
                    style={{ width: 9, height: 9, background: a.color }}
                  />
                  <span
                    className="font-mono"
                    style={{ letterSpacing: "0.04em" }}
                  >
                    {a.label.split(" ")[0]}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <VestingChart />
        </div>
      </section>

      {/* ── Utility cards ─────────────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-8 py-9">
          <div className="mb-5">
            <div className="eyebrow mb-1.5">Utility</div>
            <h3
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Four ways EQUI accrues value
            </h3>
          </div>
          <div
            className="grid grid-cols-4 bg-paper"
            style={{ border: "1px solid var(--hairline)" }}
          >
            {UTILITIES.map((u, i) => (
              <div
                key={u.tag}
                style={{
                  padding: "22px 22px",
                  borderRight: i < UTILITIES.length - 1 ? "1px solid var(--hairline)" : undefined,
                }}
              >
                <div
                  className="font-mono text-ink-mute flex items-center gap-2.5"
                  style={{ fontSize: 11, letterSpacing: "0.16em" }}
                >
                  {u.n}
                  <span
                    style={{ flex: 1, height: 1, background: "var(--hairline)" }}
                  />
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 9,
                      padding: "3px 7px",
                      background: "var(--ink)",
                      color: "var(--paper)",
                      letterSpacing: "0.12em",
                      fontWeight: 600,
                    }}
                  >
                    {u.tag}
                  </span>
                </div>
                <h4
                  className="font-serif font-medium m-0 mt-2.5"
                  style={{ fontSize: 17, letterSpacing: "-0.02em" }}
                >
                  {u.title}
                </h4>
                <p
                  className="text-ink-soft mt-2 m-0"
                  style={{ fontSize: 12.5, lineHeight: 1.6 }}
                >
                  {u.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Emissions schedule chart ──────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-8 py-9">
          <div className="flex justify-between items-end mb-5 flex-wrap gap-4">
            <div>
              <div className="eyebrow mb-1.5">Emissions schedule</div>
              <h3
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Four-year emission curve · then <span className="italic">zero</span>
              </h3>
              <p
                className="text-ink-soft mt-2 m-0 max-w-[640px]"
                style={{ fontSize: 12.5, lineHeight: 1.55 }}
              >
                Peak emissions in Y3 align with planned multi-chain expansion.
                After Y4, no new EQUI is minted — protocol fees fund all
                ongoing incentives.
              </p>
            </div>
          </div>
          <EmissionsChart />
          <div className="grid grid-cols-5 mt-5">
            {EMISSIONS_YEARS.map((y, i) => (
              <div
                key={y.label}
                style={{
                  padding: "12px 18px",
                  borderRight: i < EMISSIONS_YEARS.length - 1 ? "1px solid var(--hairline-soft)" : undefined,
                  background: "var(--paper-alt)",
                }}
              >
                <div
                  className="font-mono text-ink-mute"
                  style={{ fontSize: 10, letterSpacing: "0.14em" }}
                >
                  {y.label.toUpperCase()}
                </div>
                <div
                  className="font-serif font-medium tabular mt-1.5"
                  style={{ fontSize: 18, letterSpacing: "-0.02em" }}
                >
                  +{(y.emitted / 1_000_000).toFixed(1)}M
                </div>
                <div
                  className="font-mono text-ink-mute mt-1"
                  style={{ fontSize: 10 }}
                >
                  circ {(y.circulating / 1_000_000).toFixed(0)}M ·{" "}
                  {((y.circulating / SUPPLY) * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── USDG header ───────────────────────────────────────── */}
      <section className="bg-paper-alt border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-8 py-6 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-5">
            <div
              className="font-mono font-medium"
              style={{
                fontSize: 12,
                padding: "5px 12px",
                background: "var(--ink)",
                color: "var(--paper)",
                letterSpacing: "0.14em",
              }}
            >
              TOKEN 02 · USDG
            </div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Over-collateralized USD synthetic
            </h2>
          </div>
          <div className="flex gap-5">
            {[
              ["Peg", "1.000 USD"],
              ["Standard", "ERC-20"],
              ["Decimals", "18"],
              ["Status", "Live · v0.4.2"],
            ].map(([k, v]) => (
              <div key={k}>
                <div
                  className="font-mono text-ink-mute"
                  style={{ fontSize: 9.5, letterSpacing: "0.14em" }}
                >
                  {k.toUpperCase()}
                </div>
                <div
                  className="font-mono font-medium mt-1"
                  style={{ fontSize: 13, letterSpacing: "0.04em" }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── USDG stats strip ──────────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-4">
          {USDG_STATS.map((s, i) => (
            <div
              key={s.label}
              style={{
                padding: "20px 26px",
                borderRight: i < USDG_STATS.length - 1 ? "1px solid var(--hairline-soft)" : undefined,
              }}
            >
              <div className="eyebrow mb-2">{s.label}</div>
              <div
                className="font-serif font-medium tabular"
                style={{
                  fontSize: 26,
                  letterSpacing: "-0.025em",
                  lineHeight: 1,
                }}
              >
                {s.value}
              </div>
              <div
                className="font-mono text-ink-mute mt-2"
                style={{ fontSize: 10 }}
              >
                {s.sub}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Backing model & peg mech ──────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-2">
          <div
            style={{
              padding: "28px 30px",
              borderRight: "1px solid var(--hairline)",
            }}
          >
            <div className="eyebrow mb-1.5">Backing model</div>
            <h3
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Two assets back every USDG
            </h3>
            <p
              className="text-ink-soft mt-2.5 m-0"
              style={{ fontSize: 13, lineHeight: 1.65 }}
            >
              USDG supply is fully backed by a basket of tokenized equities
              (the borrower's pledged collateral) <em>plus</em> a USDC reserve
              of no less than 18% of circulating USDG. The combined backing
              ratio is 1.63× at the current state of the protocol.
            </p>
            <div
              className="mt-5 grid grid-cols-2 gap-3"
            >
              <div
                style={{
                  padding: "14px 16px",
                  background: "var(--paper-alt)",
                  border: "1px solid var(--hairline)",
                }}
              >
                <div className="eyebrow mb-1">Equity collateral</div>
                <div
                  className="font-serif font-medium tabular"
                  style={{ fontSize: 22, letterSpacing: "-0.02em" }}
                >
                  $61.9M
                </div>
                <div
                  className="font-mono text-ink-mute mt-1"
                  style={{ fontSize: 10 }}
                >
                  82.0% of backing
                </div>
              </div>
              <div
                style={{
                  padding: "14px 16px",
                  background: "var(--paper-alt)",
                  border: "1px solid var(--hairline)",
                }}
              >
                <div className="eyebrow mb-1">USDC reserve</div>
                <div
                  className="font-serif font-medium tabular"
                  style={{
                    fontSize: 22,
                    letterSpacing: "-0.02em",
                    color: "var(--up)",
                  }}
                >
                  $13.6M
                </div>
                <div
                  className="font-mono text-ink-mute mt-1"
                  style={{ fontSize: 10 }}
                >
                  18.0% of backing
                </div>
              </div>
            </div>
            <BackingBar />
          </div>

          <div style={{ padding: "28px 30px" }}>
            <div className="eyebrow mb-1.5">Peg mechanism</div>
            <h3
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Three rails keep USDG at $1
            </h3>
            <div className="mt-5 flex flex-col gap-3">
              {[
                {
                  n: "01",
                  t: "Hard redemption",
                  b: "Any holder may redeem USDG 1:1 against the USDC reserve, subject to a 0.05% fee and reserve availability.",
                },
                {
                  n: "02",
                  t: "Arbitrage swap",
                  b: "vault.swap() exposes a 1:1 USDC ↔ USDG path with a tight oracle-priced spread. When USDG trades below $1 externally, arbs mint and sell.",
                },
                {
                  n: "03",
                  t: "Liquidation incentive",
                  b: "Liquidators repay USDG to seize collateral, removing USDG from circulation and tightening supply during stress.",
                },
              ].map((r) => (
                <div
                  key={r.n}
                  className="grid grid-cols-[40px_1fr] gap-3 items-start"
                  style={{
                    padding: "14px 16px",
                    background: "var(--paper-alt)",
                    border: "1px solid var(--hairline)",
                  }}
                >
                  <div
                    className="font-mono text-ink-mute"
                    style={{
                      fontSize: 14,
                      letterSpacing: "0.06em",
                      fontWeight: 500,
                    }}
                  >
                    {r.n}
                  </div>
                  <div>
                    <div
                      className="font-serif font-medium"
                      style={{ fontSize: 15, letterSpacing: "-0.015em" }}
                    >
                      {r.t}
                    </div>
                    <p
                      className="text-ink-soft mt-1 m-0"
                      style={{ fontSize: 12.5, lineHeight: 1.55 }}
                    >
                      {r.b}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer disclosure ─────────────────────────────────── */}
      <section className="border-t border-ink bg-paper-alt">
        <div className="max-w-[1320px] mx-auto px-8 py-9">
          <div className="grid grid-cols-[1.4fr_1fr] gap-6 items-center">
            <div>
              <div className="eyebrow mb-2">Forward-looking statements</div>
              <p
                className="text-ink-soft m-0 max-w-[760px]"
                style={{ fontSize: 12.5, lineHeight: 1.6 }}
              >
                The schedules above describe protocol intent and on-chain
                vesting contracts at v0.4.2. Numerical figures for circulating
                supply, backing ratio, and USDC reserve reflect a snapshot at
                the time of publication. EQUI has not yet conducted a TGE; the
                allocation table is enforced by smart contract on event.
                Nothing on this page is a solicitation or offer to sell
                securities in any jurisdiction.
              </p>
            </div>
            <div className="text-right">
              <button
                className="font-medium"
                style={{
                  padding: "10px 16px",
                  fontSize: 13,
                  background: "var(--ink)",
                  color: "var(--paper)",
                  border: "none",
                  borderRadius: 2,
                  marginRight: 8,
                }}
              >
                Read full token whitepaper ↗
              </button>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/* ── Donut chart ──────────────────────────────────────────────── */

function Donut({
  alloc,
  activeKey,
  onSelect,
}: {
  alloc: Allocation[];
  activeKey: string;
  onSelect: (k: string) => void;
}) {
  const R = 96;
  const r = 56;
  const CX = 140;
  const CY = 140;

  let acc = 0;
  const total = alloc.reduce((s, a) => s + a.pct, 0);

  return (
    <svg
      viewBox="0 0 280 280"
      width="100%"
      style={{ display: "block", maxWidth: 320, margin: "20px auto 0" }}
    >
      {alloc.map((a) => {
        const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
        acc += a.pct;
        const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
        const isActive = a.key === activeKey;
        const RA = isActive ? R + 4 : R;
        const x1 = CX + RA * Math.cos(start);
        const y1 = CY + RA * Math.sin(start);
        const x2 = CX + RA * Math.cos(end);
        const y2 = CY + RA * Math.sin(end);
        const x3 = CX + r * Math.cos(end);
        const y3 = CY + r * Math.sin(end);
        const x4 = CX + r * Math.cos(start);
        const y4 = CY + r * Math.sin(start);
        const large = end - start > Math.PI ? 1 : 0;
        const d = `M ${x1} ${y1} A ${RA} ${RA} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${large} 0 ${x4} ${y4} Z`;
        return (
          <path
            key={a.key}
            d={d}
            fill={a.color}
            opacity={isActive ? 1 : 0.78}
            stroke="var(--paper)"
            strokeWidth="2"
            onClick={() => onSelect(a.key)}
            style={{ cursor: "pointer" }}
          />
        );
      })}
      <text
        x={CX}
        y={CY - 6}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="10"
        fill="var(--ink-mute)"
        letterSpacing="0.14em"
      >
        TOTAL SUPPLY
      </text>
      <text
        x={CX}
        y={CY + 16}
        textAnchor="middle"
        fontFamily="var(--font-serif)"
        fontSize="22"
        fill="var(--ink)"
        fontWeight="500"
        letterSpacing="-0.02em"
      >
        100M EQUI
      </text>
    </svg>
  );
}

/* ── Vesting timeline chart ───────────────────────────────────── */

function VestingChart() {
  const W = 1180;
  const H = 280;
  const TOP = 18;
  const BASE = H - 34;
  const LEFT = 50;
  const RIGHT = 20;

  const MONTHS = 60;
  const xs = (m: number) => LEFT + (m / MONTHS) * (W - LEFT - RIGHT);
  const ys = (v: number) => BASE - (v / SUPPLY) * (BASE - TOP);

  /// Linear vesting schedule for one cohort. Returns the unlocked amount at
  /// month m given cliffMonths and totalDuration (linear post-cliff).
  const unlocked = (
    total: number,
    cliffMonths: number,
    durationMonths: number,
    m: number,
    immediate = 0,
  ): number => {
    if (m <= 0) return immediate;
    if (m < cliffMonths) return immediate;
    const past = Math.min(m - cliffMonths, durationMonths);
    return immediate + (total - immediate) * (past / durationMonths);
  };

  const cohortAt = (key: string, m: number): number => {
    switch (key) {
      case "community":
        return unlocked(38_000_000, 0, 60, m);
      case "treasury":
        return unlocked(22_000_000, 12, 48, m);
      case "team":
        return unlocked(18_000_000, 12, 36, m);
      case "investors":
        return unlocked(14_000_000, 12, 30, m);
      case "airdrop":
        return unlocked(8_000_000, 0, 6, m);
      default:
        return 0;
    }
  };

  const stack = useMemo(() => {
    const points: number[][] = [];
    for (let m = 0; m <= MONTHS; m++) {
      let acc = 0;
      const row: number[] = [];
      for (const a of ALLOC) {
        acc += cohortAt(a.key, m);
        row.push(acc);
      }
      points.push(row);
    }
    return points;
  }, []);

  const pathFor = (i: number): string => {
    const top: string[] = [];
    const bottom: string[] = [];
    for (let m = 0; m <= MONTHS; m++) {
      const x = xs(m);
      const upper = ys(stack[m][i]);
      const lower = i === 0 ? ys(0) : ys(stack[m][i - 1]);
      top.push(`${m === 0 ? "M" : "L"} ${x} ${upper}`);
      bottom.push(`L ${x} ${lower}`);
    }
    bottom.reverse();
    return `${top.join(" ")} ${bottom.join(" ")} Z`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {/* gridlines + axis labels */}
      {[0.25, 0.5, 0.75, 1].map((f) => {
        const y = BASE - (BASE - TOP) * f;
        return (
          <g key={f}>
            <line
              x1={LEFT}
              x2={W - RIGHT}
              y1={y}
              y2={y}
              stroke="var(--hairline-soft)"
              strokeDasharray="2 4"
            />
            <text
              x={LEFT - 8}
              y={y + 3}
              textAnchor="end"
              fontFamily="var(--font-mono)"
              fontSize="9"
              fill="var(--ink-mute)"
            >
              {(f * 100).toFixed(0)}M
            </text>
          </g>
        );
      })}
      {/* year markers */}
      {[0, 12, 24, 36, 48, 60].map((m) => (
        <g key={m}>
          <line
            x1={xs(m)}
            x2={xs(m)}
            y1={TOP}
            y2={BASE}
            stroke="var(--hairline-soft)"
            strokeDasharray="2 4"
          />
          <text
            x={xs(m)}
            y={BASE + 16}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="10"
            fill="var(--ink-mute)"
            letterSpacing="0.06em"
          >
            Y{m / 12}
          </text>
        </g>
      ))}
      {/* cliff marker */}
      <line
        x1={xs(12)}
        x2={xs(12)}
        y1={TOP - 4}
        y2={BASE + 4}
        stroke="var(--amber)"
        strokeWidth="1"
        strokeDasharray="3 3"
        opacity="0.65"
      />
      <text
        x={xs(12) + 6}
        y={TOP + 8}
        fontFamily="var(--font-mono)"
        fontSize="9"
        fill="var(--amber)"
        letterSpacing="0.08em"
      >
        12M CLIFF
      </text>

      {/* stack */}
      {ALLOC.map((a, i) => (
        <path key={a.key} d={pathFor(i)} fill={a.color} opacity="0.85" stroke="var(--paper)" strokeWidth="0.5" />
      ))}

      {/* baseline */}
      <line
        x1={LEFT}
        x2={W - RIGHT}
        y1={BASE}
        y2={BASE}
        stroke="var(--ink)"
        strokeWidth="1"
      />
    </svg>
  );
}

/* ── Emissions chart (bar) ────────────────────────────────────── */

function EmissionsChart() {
  const W = 1180;
  const H = 240;
  const TOP = 24;
  const BASE = H - 36;
  const LEFT = 50;
  const RIGHT = 20;

  const max = Math.max(...EMISSIONS_YEARS.map((y) => y.emitted));
  const barW = (W - LEFT - RIGHT) / EMISSIONS_YEARS.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1={LEFT}
            x2={W - RIGHT}
            y1={BASE - (BASE - TOP) * f}
            y2={BASE - (BASE - TOP) * f}
            stroke="var(--hairline-soft)"
            strokeDasharray="2 4"
          />
          <text
            x={LEFT - 8}
            y={BASE - (BASE - TOP) * f + 3}
            textAnchor="end"
            fontFamily="var(--font-mono)"
            fontSize="9"
            fill="var(--ink-mute)"
          >
            {((f * max) / 1_000_000).toFixed(0)}M
          </text>
        </g>
      ))}
      {EMISSIONS_YEARS.map((y, i) => {
        const x = LEFT + i * barW;
        const h = (y.emitted / max) * (BASE - TOP);
        const isPeak = y.emitted === max;
        return (
          <g key={y.label}>
            <rect
              x={x + 16}
              y={BASE - h}
              width={barW - 32}
              height={h}
              fill={isPeak ? "var(--ink)" : "var(--ink-soft)"}
              opacity={isPeak ? 1 : 0.85}
            />
            <rect
              x={x + 16}
              y={BASE - h}
              width={barW - 32}
              height={h}
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1"
            />
            <text
              x={x + barW / 2}
              y={BASE - h - 8}
              textAnchor="middle"
              fontFamily="var(--font-serif)"
              fontSize="14"
              fill="var(--ink)"
              fontWeight="500"
              letterSpacing="-0.015em"
            >
              +{(y.emitted / 1_000_000).toFixed(1)}M
            </text>
            <text
              x={x + barW / 2}
              y={BASE + 18}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="11"
              fill="var(--ink-soft)"
              fontWeight={isPeak ? 600 : 500}
              letterSpacing="0.06em"
            >
              {y.label.toUpperCase()}
            </text>
            {isPeak && (
              <text
                x={x + barW / 2}
                y={BASE - h - 24}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="9"
                fill="var(--ink)"
                letterSpacing="0.14em"
                fontWeight="600"
              >
                PEAK
              </text>
            )}
          </g>
        );
      })}
      <line
        x1={LEFT}
        x2={W - RIGHT}
        y1={BASE}
        y2={BASE}
        stroke="var(--ink)"
        strokeWidth="1"
      />
    </svg>
  );
}

/* ── Backing horizontal bar ───────────────────────────────────── */

function BackingBar() {
  const equityPct = 82;
  const usdcPct = 18;
  return (
    <div className="mt-5">
      <div
        className="font-mono text-ink-mute mb-2"
        style={{ fontSize: 10, letterSpacing: "0.14em" }}
      >
        BACKING COMPOSITION · 1.63× COVER
      </div>
      <div
        style={{
          height: 22,
          background: "var(--paper-alt)",
          border: "1px solid var(--hairline)",
          display: "flex",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${equityPct}%`,
            background: "var(--ink)",
            color: "var(--paper)",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            letterSpacing: "0.06em",
          }}
          className="font-mono"
        >
          EQUITIES {equityPct}%
        </div>
        <div
          style={{
            width: `${usdcPct}%`,
            background: "var(--up)",
            color: "var(--paper)",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            letterSpacing: "0.06em",
          }}
          className="font-mono"
        >
          USDC {usdcPct}%
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className="font-medium text-ink-mute uppercase"
      style={{
        padding: "10px 10px",
        textAlign: align,
        fontSize: 10,
        letterSpacing: "0.12em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}
