"use client";

import { useMemo, useState } from "react";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";

type ProposalStatus = "ACTIVE" | "EXECUTED" | "DEFEATED" | "PENDING";

type Proposal = {
  id: string;
  title: string;
  summary: string;
  status: ProposalStatus;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  quorum: number;
  totalSupply: number;
  endsInSecs: number;
  proposer: string;
  discussionUrl: string;
  category: "Parameter" | "Treasury" | "Upgrade" | "Listing";
};

type Delegate = {
  rank: number;
  handle: string;
  address: string;
  power: number;
  delegators: number;
  participation: number;
};

const ACTIVE_PROPOSALS: Proposal[] = [
  {
    id: "EQUI-0042",
    title: "Raise NVDA LTV from 65% to 70%",
    summary:
      "Pyth feed depth has tripled since the last review. The risk team recommends loosening NVDA's collateral factor by 5 bps to capture additional borrow demand while keeping the liquidation buffer above the 12% safety floor.",
    status: "ACTIVE",
    forVotes: 18_420_000,
    againstVotes: 3_910_000,
    abstainVotes: 612_000,
    quorum: 25_000_000,
    totalSupply: 100_000_000,
    endsInSecs: 2 * 86400 + 4 * 3600 + 17 * 60,
    proposer: "0x4a2c…91dE",
    discussionUrl: "#",
    category: "Parameter",
  },
  {
    id: "EQUI-0041",
    title: "Fund OpenZeppelin re-audit of OracleAdapter v3",
    summary:
      "Allocate 180,000 USDG from the treasury for a six-week deep-dive audit covering the Pyth pull adapter, the staleness guard, and the new circuit-breaker hooks added in commit a47c2f9.",
    status: "ACTIVE",
    forVotes: 24_180_000,
    againstVotes: 1_240_000,
    abstainVotes: 305_000,
    quorum: 25_000_000,
    totalSupply: 100_000_000,
    endsInSecs: 5 * 86400 + 11 * 3600,
    proposer: "0x82bf…04A1",
    discussionUrl: "#",
    category: "Treasury",
  },
  {
    id: "EQUI-0040",
    title: "List SPY as collateral · LTV 80% · cap 50M USDG",
    summary:
      "Onboard the tokenized S&P 500 ETF as collateral. Conservative parameters reflect index-level vol. Borrow cap is half the initial circulating supply on Robinhood Chain to limit single-asset concentration.",
    status: "ACTIVE",
    forVotes: 9_840_000,
    againstVotes: 8_710_000,
    abstainVotes: 1_205_000,
    quorum: 25_000_000,
    totalSupply: 100_000_000,
    endsInSecs: 17 * 3600 + 42 * 60,
    proposer: "0xc1d9…7b22",
    discussionUrl: "#",
    category: "Listing",
  },
  {
    id: "EQUI-0039",
    title: "Reduce liquidation bonus from 5.0% to 4.5%",
    summary:
      "Bot inventory and gas sponsorship have made the current 5% liquidator bonus more than competitive. Lowering it 50 bps returns ~$1.1M/yr of capital to borrowers without slowing close times.",
    status: "PENDING",
    forVotes: 0,
    againstVotes: 0,
    abstainVotes: 0,
    quorum: 25_000_000,
    totalSupply: 100_000_000,
    endsInSecs: 9 * 86400,
    proposer: "0x37e4…f0Ac",
    discussionUrl: "#",
    category: "Parameter",
  },
];

const PAST_PROPOSALS: Array<{
  id: string;
  title: string;
  status: ProposalStatus;
  result: string;
  closed: string;
  category: Proposal["category"];
}> = [
  {
    id: "EQUI-0038",
    title: "Deploy Pyth pull-oracle adapter to mainnet",
    status: "EXECUTED",
    result: "98.2% for · queued in timelock · executed 2026-04-29",
    closed: "21 days ago",
    category: "Upgrade",
  },
  {
    id: "EQUI-0037",
    title: "Raise TSLA borrow cap from 25M → 40M USDG",
    status: "EXECUTED",
    result: "84.6% for · executed 2026-04-22",
    closed: "28 days ago",
    category: "Parameter",
  },
  {
    id: "EQUI-0036",
    title: "Buy back 1.5M EQUI from open market",
    status: "DEFEATED",
    result: "39.1% for · failed to reach 60% threshold",
    closed: "34 days ago",
    category: "Treasury",
  },
  {
    id: "EQUI-0035",
    title: "Add COIN as collateral · LTV 55%",
    status: "EXECUTED",
    result: "76.3% for · executed 2026-04-08",
    closed: "42 days ago",
    category: "Listing",
  },
  {
    id: "EQUI-0034",
    title: "Compensate users affected by 03-14 oracle stall",
    status: "EXECUTED",
    result: "99.4% for · 312K USDG disbursed",
    closed: "58 days ago",
    category: "Treasury",
  },
  {
    id: "EQUI-0033",
    title: "Migrate vault to 4-week interest-rate epochs",
    status: "DEFEATED",
    result: "47.9% for · sent back to forum",
    closed: "71 days ago",
    category: "Upgrade",
  },
];

const TOP_DELEGATES: Delegate[] = [
  {
    rank: 1,
    handle: "gauntlet.eth",
    address: "0x4a2c…91dE",
    power: 4_812_400,
    delegators: 1284,
    participation: 100,
  },
  {
    rank: 2,
    handle: "blocktower.eth",
    address: "0x82bf…04A1",
    power: 3_905_120,
    delegators: 612,
    participation: 97,
  },
  {
    rank: 3,
    handle: "robinhood-labs.eth",
    address: "0x0017…d5B2",
    power: 3_220_000,
    delegators: 39,
    participation: 92,
  },
  {
    rank: 4,
    handle: "delphi-research.eth",
    address: "0xc1d9…7b22",
    power: 2_417_800,
    delegators: 904,
    participation: 89,
  },
  {
    rank: 5,
    handle: "llama.eth",
    address: "0x37e4…f0Ac",
    power: 1_988_220,
    delegators: 1502,
    participation: 96,
  },
];

const GOV_PARAMS: Array<[string, string, string]> = [
  ["Proposal threshold", "100,000 EQUI", "0.10% of supply · staked or delegated"],
  ["Voting period", "5 days", "block-clock anchored to L3 finality"],
  ["Voting delay", "1 day", "snapshot lag before voting opens"],
  ["Quorum target", "25,000,000 EQUI", "25% of circulating supply"],
  ["Approval threshold", "60% for", "of for + against, abstain ignored"],
  ["Timelock delay", "48 hours", "applies to all on-chain effects"],
  ["Guardian veto", "Multisig 4-of-7", "emergency cancel only · sunset 2027"],
];

const TREASURY_BAL = 41_820_000;
const TOTAL_SUPPLY = 100_000_000;
const VOTING_POWER = 62_400_000;
const QUORUM_PCT = 25;

function fmtAbbr(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function fmtCountdown(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function GovernancePage() {
  const [delegateInput, setDelegateInput] = useState("");

  const activeCount = ACTIVE_PROPOSALS.filter((p) => p.status === "ACTIVE").length;
  const queuedCount = ACTIVE_PROPOSALS.filter((p) => p.status === "PENDING").length;

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav />

      {/* ── Disclaimer banner ──────────────────────────────── */}
      <div className="border-b border-hairline-soft text-center" style={{ padding: "12px 32px", background: "var(--amber-soft)" }}>
        <span className="text-ink-soft font-mono uppercase" style={{ fontSize: 12, letterSpacing: "0.06em" }}>
          ILLUSTRATIVE &middot; This page shows sample governance data for demonstration purposes. No on-chain governance is active.
        </span>
      </div>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="border-b border-ink">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-6 pb-5">
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="eyebrow mb-2">
                Governance · EQUI holders · on-chain control plane
              </div>
              <h1
                className="font-serif font-medium m-0"
                style={{ fontSize: 30, letterSpacing: "-0.025em", lineHeight: 1.05 }}
              >
                {activeCount} proposal{activeCount === 1 ? "" : "s"} live. {queuedCount} queued.{" "}
                <span className="italic">Your stake is your vote.</span>
              </h1>
              <p
                className="text-ink-soft mt-2 max-w-[640px]"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                EQUI is a vote-escrowed governance token. Every protocol parameter — LTVs, borrow
                caps, oracle adapters, treasury spend — passes through forum discussion, a 5-day
                vote, and a 48-hour timelock before it touches{" "}
                <span
                  className="font-mono"
                  style={{ background: "var(--paper-alt)", padding: "1px 5px", fontSize: 12 }}
                >
                  vault.setRiskParams()
                </span>
                . No multisig backdoors.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.08em" }}>
                NEXT VOTE CLOSES IN
              </div>
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 20, letterSpacing: "-0.02em" }}
              >
                {fmtCountdown(ACTIVE_PROPOSALS[2].endsInSecs)}
              </div>
              <div className="font-mono text-ink-mute mt-1" style={{ fontSize: 10 }}>
                EQUI-0040 · SPY listing
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── KPI strip ─────────────────────────────────────── */}
      <section className="bg-paper-alt border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCell label="EQUI supply" value={fmtAbbr(TOTAL_SUPPLY)} sub="circulating · fully diluted" />
          <KpiCell
            label="Voting power"
            value={fmtAbbr(VOTING_POWER)}
            sub={`${((VOTING_POWER / TOTAL_SUPPLY) * 100).toFixed(1)}% delegated`}
          />
          <KpiCell
            label="Quorum target"
            value={`${QUORUM_PCT}%`}
            sub="25M EQUI · per proposal"
            color="var(--amber)"
          />
          <KpiCell
            label="Treasury balance"
            value={"$" + fmtAbbr(TREASURY_BAL)}
            sub="USDG + EQUI · multisig + DAO"
            color="var(--up)"
          />
          <KpiCell
            label="Proposals · YTD"
            value="42"
            sub="29 executed · 9 defeated · 4 live"
            last
          />
        </div>
      </section>

      {/* ── Active proposals ──────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
          <div className="flex justify-between items-baseline mb-3.5">
            <div>
              <div
                className="eyebrow mb-1 inline-flex items-center gap-1.5"
                style={{ color: "var(--up)" }}
              >
                <span>●</span>
                <span>Open for voting · {ACTIVE_PROPOSALS.length} proposals</span>
              </div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Active <span className="italic">proposals</span>
              </h2>
              <p className="text-ink-mute mt-1.5 m-0" style={{ fontSize: 12 }}>
                Snapshot taken at proposal creation. Vote with the EQUI you held at that block —
                later transfers don&apos;t change your weight.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="font-medium transition-colors"
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  background: "var(--paper)",
                  color: "var(--ink)",
                  border: "1px solid var(--hairline)",
                  borderRadius: 2,
                }}
              >
                Open forum
              </button>
              <button
                className="font-medium inline-flex items-center gap-2 transition-colors"
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  background: "var(--ink)",
                  color: "var(--paper)",
                  border: "none",
                  borderRadius: 2,
                }}
              >
                Submit proposal
                <span className="font-mono" style={{ fontSize: 10, opacity: 0.7 }}>
                  → 100K EQUI
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {ACTIVE_PROPOSALS.map((p) => (
              <ProposalCard key={p.id} p={p} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Delegation panel + Top delegates ──────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-1 md:grid-cols-[1fr_1.3fr]">
          <div
            style={{ padding: "24px 28px", borderRight: "1px solid var(--hairline)" }}
          >
            <div className="eyebrow mb-1">Delegation · your voting power</div>
            <h3
              className="font-serif font-medium m-0"
              style={{ fontSize: 20, letterSpacing: "-0.02em" }}
            >
              Delegate your <span className="italic">EQUI</span>
            </h3>
            <p
              className="text-ink-soft mt-2"
              style={{ fontSize: 12, lineHeight: 1.55 }}
            >
              Delegating doesn&apos;t move your tokens. It assigns your voting weight to an address —
              they vote on your behalf until you re-delegate or self-delegate. You can override on
              any single proposal.
            </p>
            <div
              className="mt-4"
              style={{ border: "1px solid var(--hairline)", padding: 14 }}
            >
              <label
                className="font-mono text-ink-mute"
                style={{ fontSize: 10, letterSpacing: "0.12em" }}
              >
                DELEGATE TO
              </label>
              <input
                value={delegateInput}
                onChange={(e) => setDelegateInput(e.target.value)}
                placeholder="0x… or ens.eth"
                className="font-mono w-full mt-1.5"
                style={{
                  padding: "8px 10px",
                  fontSize: 12,
                  border: "1px solid var(--hairline)",
                  background: "var(--paper)",
                  color: "var(--ink)",
                  borderRadius: 2,
                  outline: "none",
                }}
              />
              <div className="flex gap-2 mt-3">
                <button
                  className="font-medium flex-1"
                  style={{
                    padding: "9px 14px",
                    fontSize: 12,
                    background: "var(--ink)",
                    color: "var(--paper)",
                    border: "none",
                    borderRadius: 2,
                  }}
                >
                  Delegate
                </button>
                <button
                  onClick={() => setDelegateInput("")}
                  className="font-medium"
                  style={{
                    padding: "9px 14px",
                    fontSize: 12,
                    background: "transparent",
                    color: "var(--ink-soft)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 2,
                  }}
                >
                  Self
                </button>
              </div>
              <div
                className="font-mono text-ink-mute mt-3"
                style={{ fontSize: 10, lineHeight: 1.5 }}
              >
                Gas-sponsored · settles in ~12s on Robinhood Chain
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <MiniStat label="Your balance" value="—" sub="connect wallet" />
              <MiniStat label="Delegated to" value="self" sub="default" />
              <MiniStat label="Proposals voted" value="0 / 42" sub="lifetime" />
              <MiniStat label="Voting streak" value="—" sub="participation rate" />
            </div>
          </div>

          <div style={{ padding: "24px 28px" }}>
            <div className="flex justify-between items-baseline mb-3.5">
              <div>
                <div className="eyebrow mb-1">Leaderboard · by EQUI weight</div>
                <h3
                  className="font-serif font-medium m-0"
                  style={{ fontSize: 20, letterSpacing: "-0.02em" }}
                >
                  Top delegates
                </h3>
              </div>
              <span className="font-mono text-ink-mute" style={{ fontSize: 10 }}>
                5 of 187 active
              </span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--ink)" }}>
                  <Th>Delegate</Th>
                  <Th align="right">Voting power</Th>
                  <Th align="right">Delegators</Th>
                  <Th align="right">Participation</Th>
                </tr>
              </thead>
              <tbody>
                {TOP_DELEGATES.map((d) => (
                  <tr
                    key={d.address}
                    style={{ borderBottom: "1px dashed var(--hairline-soft)" }}
                  >
                    <td style={{ padding: "12px 8px" }}>
                      <div className="flex items-center gap-2.5">
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 11,
                            padding: "2px 7px",
                            borderRadius: 2,
                            background: d.rank === 1 ? "var(--ink)" : "var(--paper-alt)",
                            color: d.rank === 1 ? "var(--paper)" : "var(--ink-soft)",
                            fontWeight: 600,
                            letterSpacing: "0.04em",
                          }}
                        >
                          #{d.rank}
                        </span>
                        <div>
                          <div
                            className="font-mono"
                            style={{ fontSize: 12, fontWeight: 500 }}
                          >
                            {d.handle}
                          </div>
                          <div
                            className="font-mono text-ink-mute"
                            style={{ fontSize: 10 }}
                          >
                            {d.address}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right" }}>
                      <div
                        className="font-serif font-medium tabular"
                        style={{ fontSize: 15, letterSpacing: "-0.02em" }}
                      >
                        {fmtAbbr(d.power)}
                      </div>
                      <div
                        className="font-mono text-ink-mute mt-0.5"
                        style={{ fontSize: 10 }}
                      >
                        {((d.power / TOTAL_SUPPLY) * 100).toFixed(2)}% of supply
                      </div>
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right" }}>
                      <span className="font-mono tabular" style={{ fontSize: 12 }}>
                        {d.delegators.toLocaleString()}
                      </span>
                    </td>
                    <td style={{ padding: "12px 8px", textAlign: "right" }}>
                      <span
                        className="font-mono tabular font-medium"
                        style={{
                          fontSize: 12,
                          color: d.participation >= 95 ? "var(--up)" : "var(--ink)",
                        }}
                      >
                        {d.participation}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Past proposals ────────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
          <div className="flex justify-between items-baseline mb-3.5">
            <div>
              <div className="eyebrow mb-1">History · last 12 months</div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Past <span className="italic">proposals</span>
              </h2>
              <p className="text-ink-mute mt-1.5 m-0" style={{ fontSize: 12 }}>
                Every executed proposal is enforceable on-chain. Defeated proposals return to the
                forum for revision.
              </p>
            </div>
            <a
              href="#"
              className="font-mono no-underline text-ink-soft"
              style={{ fontSize: 11 }}
            >
              Full archive ↗
            </a>
          </div>

          <div style={{ border: "1px solid var(--hairline)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--hairline)",
                    background: "var(--paper-alt)",
                  }}
                >
                  <Th>ID</Th>
                  <Th>Title</Th>
                  <Th>Category</Th>
                  <Th>Status</Th>
                  <Th>Result</Th>
                  <Th align="right">Closed</Th>
                </tr>
              </thead>
              <tbody>
                {PAST_PROPOSALS.map((p) => (
                  <tr
                    key={p.id}
                    style={{ borderBottom: "1px solid var(--hairline-soft)" }}
                  >
                    <td style={{ padding: "12px 14px" }}>
                      <span
                        className="font-mono"
                        style={{ fontSize: 11, fontWeight: 500 }}
                      >
                        {p.id}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ fontSize: 13 }}>{p.title}</span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          border: "1px solid var(--hairline)",
                          color: "var(--ink-soft)",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {p.category.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <StatusBadge status={p.status} />
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span className="font-mono text-ink-soft" style={{ fontSize: 11 }}>
                        {p.result}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "right" }}>
                      <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>
                        {p.closed}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Governance parameters ─────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
          <div className="flex justify-between items-baseline mb-3.5">
            <div>
              <div className="eyebrow mb-1">Constitution · on-chain</div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Governance parameters
              </h2>
              <p className="text-ink-mute mt-1.5 m-0" style={{ fontSize: 12 }}>
                Read directly from{" "}
                <span
                  className="font-mono"
                  style={{ background: "var(--paper-alt)", padding: "1px 5px", fontSize: 11 }}
                >
                  Governor.sol
                </span>
                . Changes require a proposal to amend the constitution itself.
              </p>
            </div>
          </div>

          <div
            className="grid grid-cols-2 lg:grid-cols-4"
            style={{ border: "1px solid var(--hairline)" }}
          >
            {GOV_PARAMS.map((row, i) => {
              const [k, v, sub] = row;
              const cols = 4;
              return (
                <div
                  key={k}
                  style={{
                    padding: "16px 18px",
                    borderRight:
                      (i + 1) % cols !== 0 ? "1px solid var(--hairline-soft)" : undefined,
                    borderBottom:
                      i < GOV_PARAMS.length - cols ? "1px solid var(--hairline-soft)" : undefined,
                  }}
                >
                  <div className="eyebrow mb-1.5">{k}</div>
                  <div
                    className="font-serif font-medium tabular"
                    style={{ fontSize: 18, letterSpacing: "-0.02em", lineHeight: 1.1 }}
                  >
                    {v}
                  </div>
                  <div
                    className="font-mono text-ink-mute mt-1.5"
                    style={{ fontSize: 10, lineHeight: 1.4 }}
                  >
                    {sub}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── How governance works ──────────────────────────── */}
      <HowGovernanceWorks />

      <SiteFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */

function ProposalCard({ p }: { p: Proposal }) {
  const totalCast = p.forVotes + p.againstVotes + p.abstainVotes;
  const forPct = totalCast > 0 ? (p.forVotes / totalCast) * 100 : 0;
  const againstPct = totalCast > 0 ? (p.againstVotes / totalCast) * 100 : 0;
  const abstainPct = totalCast > 0 ? (p.abstainVotes / totalCast) * 100 : 0;
  const quorumPct = Math.min(100, (totalCast / p.quorum) * 100);
  const passing =
    p.forVotes > p.againstVotes && totalCast >= p.quorum;

  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        background: "var(--paper)",
        padding: 18,
      }}
    >
      <div className="flex justify-between items-start gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              padding: "2px 7px",
              border: "1px solid var(--hairline)",
              borderRadius: 2,
              color: "var(--ink-soft)",
              fontWeight: 600,
            }}
          >
            {p.id}
          </span>
          <StatusBadge status={p.status} />
          <span
            className="font-mono"
            style={{
              fontSize: 9,
              padding: "1px 5px",
              color: "var(--ink-mute)",
              letterSpacing: "0.08em",
            }}
          >
            {p.category.toUpperCase()}
          </span>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-ink-mute" style={{ fontSize: 9, letterSpacing: "0.08em" }}>
            {p.status === "PENDING" ? "VOTING OPENS IN" : "VOTING ENDS IN"}
          </div>
          <div
            className="font-mono tabular font-medium"
            style={{ fontSize: 12, color: p.endsInSecs < 86400 ? "var(--amber)" : "var(--ink)" }}
          >
            {fmtCountdown(p.endsInSecs)}
          </div>
        </div>
      </div>

      <h3
        className="font-serif font-medium m-0"
        style={{ fontSize: 17, letterSpacing: "-0.02em", lineHeight: 1.25 }}
      >
        {p.title}
      </h3>
      <p
        className="text-ink-soft m-0 mt-2"
        style={{ fontSize: 12, lineHeight: 1.5 }}
      >
        {p.summary}
      </p>

      {/* Vote outcome SVG */}
      <div className="mt-4">
        <VoteChart
          forVotes={p.forVotes}
          againstVotes={p.againstVotes}
          abstainVotes={p.abstainVotes}
        />
      </div>

      {/* For / against / abstain bars */}
      <div className="mt-3.5 space-y-2">
        <VoteBar label="For" pct={forPct} value={p.forVotes} color="var(--up)" />
        <VoteBar label="Against" pct={againstPct} value={p.againstVotes} color="var(--down)" />
        <VoteBar label="Abstain" pct={abstainPct} value={p.abstainVotes} color="var(--ink-mute)" />
      </div>

      {/* Quorum bar */}
      <div className="mt-4">
        <div className="flex justify-between items-baseline mb-1">
          <span className="eyebrow">Quorum</span>
          <span
            className="font-mono tabular"
            style={{
              fontSize: 11,
              color: totalCast >= p.quorum ? "var(--up)" : "var(--amber)",
              fontWeight: 500,
            }}
          >
            {fmtAbbr(totalCast)} / {fmtAbbr(p.quorum)} · {quorumPct.toFixed(1)}%
          </span>
        </div>
        <div style={{ height: 4, background: "var(--hairline-soft)", position: "relative" }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${quorumPct}%`,
              background: totalCast >= p.quorum ? "var(--up)" : "var(--amber)",
            }}
          />
        </div>
      </div>

      <div
        className="mt-4 flex justify-between items-center"
        style={{ paddingTop: 12, borderTop: "1px dashed var(--hairline-soft)" }}
      >
        <div className="font-mono text-ink-mute" style={{ fontSize: 10 }}>
          Proposer · {p.proposer} ·{" "}
          <span style={{ color: passing ? "var(--up)" : "var(--ink-mute)" }}>
            {passing ? "PASSING" : p.status === "PENDING" ? "QUEUED" : "BELOW QUORUM"}
          </span>
        </div>
        <div className="flex gap-2">
          <a
            href={p.discussionUrl}
            className="font-mono no-underline"
            style={{
              padding: "5px 10px",
              fontSize: 11,
              color: "var(--ink-soft)",
              border: "1px solid var(--hairline)",
              borderRadius: 2,
            }}
          >
            Discuss
          </a>
          <button
            disabled={p.status !== "ACTIVE"}
            className="font-medium"
            style={{
              padding: "5px 12px",
              fontSize: 11,
              background: p.status === "ACTIVE" ? "var(--ink)" : "var(--ink-mute)",
              color: "var(--paper)",
              border: "none",
              borderRadius: 2,
              opacity: p.status === "ACTIVE" ? 1 : 0.5,
              cursor: p.status === "ACTIVE" ? "pointer" : "not-allowed",
            }}
          >
            Vote
          </button>
        </div>
      </div>
    </div>
  );
}

function VoteChart({
  forVotes,
  againstVotes,
  abstainVotes,
}: {
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
}) {
  const total = forVotes + againstVotes + abstainVotes;
  const W = 480;
  const H = 72;
  if (total === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <rect x={0} y={H / 2 - 1} width={W} height={2} fill="var(--hairline)" />
        <text
          x={W / 2}
          y={H / 2 + 18}
          fontSize="10"
          fontFamily="var(--font-mono)"
          fill="var(--ink-mute)"
          textAnchor="middle"
          letterSpacing="0.08em"
        >
          NO VOTES CAST YET
        </text>
      </svg>
    );
  }

  /// Stacked horizontal bar showing share of cast votes, plus a marker line at 60% — the
  /// approval threshold. Each segment is offset so the threshold reads against the
  /// for-segment edge.
  const forW = (forVotes / total) * W;
  const againstW = (againstVotes / total) * W;
  const abstainW = (abstainVotes / total) * W;
  const thresholdX = W * 0.6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {/* Segments */}
      <rect x={0} y={16} width={forW} height={28} fill="var(--up)" opacity="0.85" />
      <rect x={forW} y={16} width={againstW} height={28} fill="var(--down)" opacity="0.85" />
      <rect x={forW + againstW} y={16} width={abstainW} height={28} fill="var(--ink-mute)" opacity="0.6" />
      <rect
        x={0}
        y={16}
        width={W}
        height={28}
        fill="none"
        stroke="var(--ink)"
        strokeWidth="1"
      />
      {/* Threshold line at 60% */}
      <line
        x1={thresholdX}
        x2={thresholdX}
        y1={10}
        y2={54}
        stroke="var(--ink)"
        strokeDasharray="3 3"
      />
      <text
        x={thresholdX + 4}
        y={10}
        fontSize="9"
        fontFamily="var(--font-mono)"
        fill="var(--ink-soft)"
        letterSpacing="0.06em"
      >
        60% THRESHOLD
      </text>
      {/* Bottom labels */}
      <text
        x={4}
        y={62}
        fontSize="10"
        fontFamily="var(--font-mono)"
        fill="var(--up)"
        fontWeight="500"
      >
        {((forVotes / total) * 100).toFixed(1)}% FOR
      </text>
      <text
        x={W - 4}
        y={62}
        fontSize="10"
        fontFamily="var(--font-mono)"
        fill="var(--down)"
        fontWeight="500"
        textAnchor="end"
      >
        {((againstVotes / total) * 100).toFixed(1)}% AGAINST
      </text>
    </svg>
  );
}

function VoteBar({
  label,
  pct,
  value,
  color,
}: {
  label: string;
  pct: number;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="font-mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>
          {label}
        </span>
        <span className="font-mono tabular" style={{ fontSize: 11 }}>
          {fmtAbbr(value)} EQUI · {pct.toFixed(1)}%
        </span>
      </div>
      <div style={{ height: 3, background: "var(--hairline-soft)", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ProposalStatus }) {
  const map: Record<ProposalStatus, { bg: string; fg: string; border: string }> = {
    ACTIVE: { bg: "var(--up-soft)", fg: "var(--up)", border: "var(--up)" },
    EXECUTED: { bg: "var(--paper-alt)", fg: "var(--ink-soft)", border: "var(--hairline)" },
    DEFEATED: { bg: "var(--down-soft)", fg: "var(--down)", border: "var(--down)" },
    PENDING: { bg: "var(--amber-soft)", fg: "var(--amber)", border: "var(--amber)" },
  };
  const c = map[status];
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 9,
        padding: "2px 7px",
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        borderRadius: 2,
        letterSpacing: "0.08em",
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

function MiniStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--hairline-soft)",
        padding: "10px 12px",
      }}
    >
      <div className="eyebrow mb-1" style={{ fontSize: 9 }}>
        {label}
      </div>
      <div
        className="font-serif font-medium tabular"
        style={{ fontSize: 16, letterSpacing: "-0.02em", lineHeight: 1.1 }}
      >
        {value}
      </div>
      <div
        className="font-mono text-ink-mute mt-1"
        style={{ fontSize: 9 }}
      >
        {sub}
      </div>
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  color,
  last,
}: {
  label: string;
  value: string;
  sub: string;
  color?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "18px 24px",
        borderRight: last ? undefined : "1px solid var(--hairline-soft)",
      }}
    >
      <div className="eyebrow mb-2.5">{label}</div>
      <div
        className="font-serif font-medium tabular"
        style={{
          fontSize: 30,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: color ?? "var(--ink)",
        }}
      >
        {value}
      </div>
      <div
        className="font-mono tabular text-ink-mute mt-2"
        style={{ fontSize: 10 }}
      >
        {sub}
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
        padding: "10px 14px",
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

function HowGovernanceWorks() {
  const steps = [
    {
      n: "01",
      title: "Discuss",
      body: "Drafts start as forum posts. Author and risk reviewers iterate publicly for at least 72 hours. Off-chain Snapshot poll confirms rough consensus.",
    },
    {
      n: "02",
      title: "Propose",
      body: "Author posts on-chain with the executable calldata. A 100K EQUI threshold prevents spam. A 1-day voting delay lets holders snapshot.",
    },
    {
      n: "03",
      title: "Vote",
      body: "5-day window. EQUI weight at the snapshot block decides. 60% for and 25M EQUI quorum required to pass. Delegates can be overridden per-proposal.",
    },
    {
      n: "04",
      title: "Execute via timelock",
      body: "Passed proposals queue for 48h. Anyone can execute after delay. The timelock owns the protocol — no admin key, no shortcut.",
    },
  ];
  return (
    <section className="border-t border-ink bg-paper-alt">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8">
        <div className="mb-5">
          <div className="eyebrow mb-1.5">How EquiFlow governance works</div>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: 22, letterSpacing: "-0.025em" }}
          >
            Four steps from <span className="italic">forum thread</span> to on-chain effect.
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-paper" style={{ border: "1px solid var(--hairline)" }}>
          {steps.map((s, i) => (
            <div
              key={s.n}
              style={{
                padding: "20px 22px",
                borderRight:
                  i < steps.length - 1 ? "1px solid var(--hairline)" : undefined,
              }}
            >
              <div
                className="font-mono text-ink-mute flex items-center gap-2.5"
                style={{ fontSize: 11, letterSpacing: "0.16em" }}
              >
                {s.n}
                <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
              </div>
              <h4
                className="font-serif font-medium"
                style={{ fontSize: 16, letterSpacing: "-0.015em", margin: "12px 0 8px" }}
              >
                {s.title}
              </h4>
              <p className="text-ink-soft m-0" style={{ fontSize: 12, lineHeight: 1.5 }}>
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
