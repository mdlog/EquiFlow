"use client";

import { useState } from "react";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";

type Severity = "Critical" | "High" | "Medium" | "Low" | "Informational";

type ScopeAsset = {
  name: string;
  address: string;
  loc: string;
  audit: string;
  auditFirms: string[];
  scope: string;
  inScope: boolean;
};

type ReportRow = {
  id: string;
  date: string;
  severity: Severity | "—";
  title: string;
  status: "RESOLVED" | "IN TRIAGE" | "DISCLOSED" | "DUPLICATE";
  reward: number | null;
  researcher: string;
  redacted: boolean;
};

const SEVERITY_TIERS: Array<{
  severity: Severity;
  range: string;
  rangeUsd: [number, number];
  examples: string;
  color: string;
}> = [
  {
    severity: "Critical",
    range: "$250,000 – $1,000,000",
    rangeUsd: [250_000, 1_000_000],
    examples:
      "Theft of user funds, permanent freezing of vault collateral, infinite USDG mint, oracle manipulation draining a market.",
    color: "var(--down)",
  },
  {
    severity: "High",
    range: "$50,000 – $250,000",
    rangeUsd: [50_000, 250_000],
    examples:
      "Theft of yield, temporary freezing of vault for >24h, bypass of liquidation bonus, governance vote manipulation under quorum.",
    color: "var(--down)",
  },
  {
    severity: "Medium",
    range: "$10,000 – $50,000",
    rangeUsd: [10_000, 50_000],
    examples:
      "Griefing that costs users >$10K, DoS of a single oracle adapter, fee accounting drift, accessor bypass on view-only methods.",
    color: "var(--amber)",
  },
  {
    severity: "Low",
    range: "$2,500 – $10,000",
    rangeUsd: [2_500, 10_000],
    examples:
      "Off-by-one rounding in interest accrual, frontend phishing surface, gas griefing, minor event-emission mismatches.",
    color: "var(--amber)",
  },
  {
    severity: "Informational",
    range: "$500 – $2,500",
    rangeUsd: [500, 2_500],
    examples:
      "Best-practice deviations, missing input validation that cannot be reached, hardcoded magic numbers, doc/inline-comment mismatches.",
    color: "var(--ink-mute)",
  },
];

const SCOPE_ASSETS: ScopeAsset[] = [
  {
    name: "EquiFlowVault",
    address: "0x86c4AC25524560799863505F7650B24014eDB0FB",
    loc: "src/vault/EquiFlowVault.sol · 2,840 LOC",
    audit: "Audited",
    auditFirms: ["Trail of Bits", "OpenZeppelin"],
    scope:
      "Pledge / borrow / repay / withdraw / liquidate paths. Interest model. Risk param storage. All non-view entrypoints.",
    inScope: true,
  },
  {
    name: "USDGStable",
    address: "0x7E955252E15c84f5768B83c41a71F9eba181802F",
    loc: "src/stable/USDGStable.sol · 720 LOC",
    audit: "Audited",
    auditFirms: ["OpenZeppelin", "Spearbit"],
    scope:
      "Mint authority gating, pause hooks, blocklist behavior, ERC-20 invariants. Off-chain reserve attestation is OUT of scope.",
    inScope: true,
  },
  {
    name: "OracleAdapter",
    address: "0x33dF8a2bcA9e1f0d4E2C8b9A1d7c6E5f4D3a2B11",
    loc: "src/oracle/PythAdapter.sol · 612 LOC",
    audit: "Audited",
    auditFirms: ["Trail of Bits", "Zellic"],
    scope:
      "Pyth pull-update verification, staleness guard, circuit-breaker thresholds, fallback feed routing.",
    inScope: true,
  },
  {
    name: "SmartAccountFactory",
    address: "0x00170f8AB4d9c2e1d5C6e7F8a9B0c1D2e3F4d5B2",
    loc: "src/aa/SmartAccountFactory.sol · 540 LOC",
    audit: "Audited",
    auditFirms: ["OpenZeppelin"],
    scope:
      "ERC-4337 account deployment, session-key permissioning, paymaster gating, signature validation paths.",
    inScope: true,
  },
];

const OUT_OF_SCOPE: string[] = [
  "Third-party dependencies — Pyth Network, Permit2, OpenZeppelin libraries (report upstream)",
  "Off-chain frontend issues unless they result in loss of user funds (CSRF, XSS, etc — go to the web bounty)",
  "Issues requiring control of >50% of EQUI voting power or compromise of the governance multisig",
  "Already-known issues listed in the latest audit reports or our public issue tracker",
  "Theoretical attacks without a working PoC against the testnet deployment",
  "Best-practice violations with no demonstrable impact (e.g., missing NatSpec, gas optimizations)",
  "Front-running / MEV that is inherent to public blockchains and does not violate documented invariants",
  "Issues on testnet faucet contracts, demo scripts, or anything under examples/",
];

const HALL_OF_FAME: Array<{
  rank: number;
  handle: string;
  payouts: number;
  reports: number;
  highest: string;
}> = [
  {
    rank: 1,
    handle: "researcher-1",
    payouts: 480_000,
    reports: 3,
    highest: "Critical · USDG mint bypass",
  },
  {
    rank: 2,
    handle: "researcher-2",
    payouts: 312_500,
    reports: 5,
    highest: "Critical · oracle staleness window",
  },
  {
    rank: 3,
    handle: "researcher-3",
    payouts: 184_000,
    reports: 4,
    highest: "High · liquidation bonus drain",
  },
  {
    rank: 4,
    handle: "researcher-4",
    payouts: 142_000,
    reports: 7,
    highest: "High · session-key escalation",
  },
  {
    rank: 5,
    handle: "researcher-5",
    payouts: 95_000,
    reports: 6,
    highest: "Medium · interest accrual drift",
  },
  {
    rank: 6,
    handle: "researcher-6",
    payouts: 68_000,
    reports: 4,
    highest: "Medium · paymaster gas griefing",
  },
  {
    rank: 7,
    handle: "researcher-7",
    payouts: 52_500,
    reports: 3,
    highest: "Medium · accessor bypass",
  },
];

const RECENT_REPORTS: ReportRow[] = [
  {
    id: "EQ-2026-117",
    date: "3 days ago",
    severity: "—",
    title: "[CONFIDENTIAL]",
    status: "IN TRIAGE",
    reward: null,
    researcher: "[redacted]",
    redacted: true,
  },
  {
    id: "EQ-2026-116",
    date: "8 days ago",
    severity: "—",
    title: "[CONFIDENTIAL]",
    status: "IN TRIAGE",
    reward: null,
    researcher: "[redacted]",
    redacted: true,
  },
  {
    id: "EQ-2026-114",
    date: "27 days ago",
    severity: "Critical",
    title: "USDG mint bypass via reentrant pledge in same block",
    status: "RESOLVED",
    reward: 480_000,
    researcher: "researcher-1",
    redacted: false,
  },
  {
    id: "EQ-2026-112",
    date: "41 days ago",
    severity: "High",
    title: "Liquidation bonus paid twice when liquidator == borrower",
    status: "RESOLVED",
    reward: 132_000,
    researcher: "researcher-3",
    redacted: false,
  },
  {
    id: "EQ-2026-109",
    date: "62 days ago",
    severity: "Critical",
    title: "Oracle staleness window allows stale-feed liquidation on TSLA",
    status: "RESOLVED",
    reward: 175_000,
    researcher: "researcher-2",
    redacted: false,
  },
];

const POOL_TOTAL = 2_100_000;
const HIGHEST_PAID = 480_000;
const PAID_YTD = 1_412_500;

function fmtUsdShort(n: number): string {
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + n.toLocaleString();
}

export default function BugBountyPage() {
  const [encrypting, setEncrypting] = useState(false);

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav />

      <div
        className="border-b border-hairline-soft"
        style={{ padding: "12px 32px", background: "var(--amber-soft)" }}
      >
        <span style={{ fontSize: 12, letterSpacing: "0.06em" }} className="text-ink-soft font-mono uppercase">
          ILLUSTRATIVE · Bug bounty data is illustrative. No live bounty program exists.
        </span>
      </div>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="border-b border-ink">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-6 pb-5">
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="eyebrow mb-2">
                Security · responsible disclosure · paid in USDG
              </div>
              <h1
                className="font-serif font-medium m-0"
                style={{ fontSize: 30, letterSpacing: "-0.025em", lineHeight: 1.05 }}
              >
                Break it. We&apos;ll <span className="italic">pay you</span>{" "}
                up to $1,000,000 USDG.
              </h1>
              <p
                className="text-ink-soft mt-2 max-w-[680px]"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                The EquiFlow vault holds tokenized stocks pledged by thousands of borrowers. Every
                line that touches{" "}
                <span
                  className="font-mono"
                  style={{ background: "var(--paper-alt)", padding: "1px 5px", fontSize: 12 }}
                >
                  vault.pledge()
                </span>{" "}
                or{" "}
                <span
                  className="font-mono"
                  style={{ background: "var(--paper-alt)", padding: "1px 5px", fontSize: 12 }}
                >
                  vault.borrow()
                </span>{" "}
                has been audited twice. We&apos;d rather pay you to find the bug than read about it on
                Twitter. Submit via Immunefi, encrypted, with a working PoC.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.08em" }}>
                HIGHEST PAID · TO DATE
              </div>
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 24, letterSpacing: "-0.02em", color: "var(--up)" }}
              >
                {fmtUsdShort(HIGHEST_PAID)}
              </div>
              <div className="font-mono text-ink-mute mt-1" style={{ fontSize: 10 }}>
                EQ-2026-114 · USDG mint bypass
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── KPI strip ─────────────────────────────────────── */}
      <section className="bg-paper-alt border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCell label="Bounty pool" value={fmtUsdShort(POOL_TOTAL)} sub="USDG · fully funded" color="var(--up)" />
          <KpiCell label="Highest single payout" value={fmtUsdShort(HIGHEST_PAID)} sub="Critical · in-scope" />
          <KpiCell label="Paid · YTD" value={fmtUsdShort(PAID_YTD)} sub="19 valid reports · 2026" />
          <KpiCell label="Avg triage time" value="38h" sub="from submission to severity decision" color="var(--amber)" />
          <KpiCell label="Audit coverage" value="100%" sub="every in-scope LOC · 2 firms" last />
        </div>
      </section>

      {/* ── Severity tiers ────────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
          <div className="flex justify-between items-baseline mb-3.5">
            <div>
              <div className="eyebrow mb-1">Rewards · USDG · paid within 14 days</div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Severity <span className="italic">tiers</span>
              </h2>
              <p className="text-ink-mute mt-1.5 m-0" style={{ fontSize: 12 }}>
                Severity follows Immunefi&apos;s vulnerability classification. Final payout is scaled
                by economic impact, exploitability, and quality of disclosure.
              </p>
            </div>
            <a
              href="#"
              className="font-mono no-underline text-ink-soft"
              style={{ fontSize: 11 }}
            >
              Read the classification ↗
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
                  <Th>Severity</Th>
                  <Th>Reward range · USDG</Th>
                  <Th>Visual</Th>
                  <Th>Example findings</Th>
                </tr>
              </thead>
              <tbody>
                {SEVERITY_TIERS.map((t) => {
                  const pctOfMax = t.rangeUsd[1] / SEVERITY_TIERS[0].rangeUsd[1];
                  return (
                    <tr
                      key={t.severity}
                      style={{ borderBottom: "1px solid var(--hairline-soft)" }}
                    >
                      <td style={{ padding: "14px 14px" }}>
                        <div className="flex items-center gap-2.5">
                          <span
                            className="inline-block"
                            style={{ width: 8, height: 8, background: t.color }}
                          />
                          <span
                            className="font-serif font-medium"
                            style={{ fontSize: 15, letterSpacing: "-0.015em" }}
                          >
                            {t.severity}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "14px 14px" }}>
                        <span
                          className="font-mono tabular font-medium"
                          style={{ fontSize: 13 }}
                        >
                          {t.range}
                        </span>
                      </td>
                      <td style={{ padding: "14px 14px", width: "20%" }}>
                        <div
                          style={{
                            height: 6,
                            background: "var(--hairline-soft)",
                            position: "relative",
                          }}
                        >
                          <div
                            style={{
                              position: "absolute",
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: `${pctOfMax * 100}%`,
                              background: t.color,
                            }}
                          />
                        </div>
                        <div
                          className="font-mono text-ink-mute mt-1"
                          style={{ fontSize: 10 }}
                        >
                          up to {fmtUsdShort(t.rangeUsd[1])}
                        </div>
                      </td>
                      <td style={{ padding: "14px 14px" }}>
                        <span
                          className="text-ink-soft"
                          style={{ fontSize: 12, lineHeight: 1.5 }}
                        >
                          {t.examples}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            className="mt-4 grid grid-cols-3 gap-3"
            style={{ paddingTop: 4 }}
          >
            <PolicyChip
              k="Payout currency"
              v="USDG · settled on Robinhood Chain (Arbitrum Orbit L3)"
            />
            <PolicyChip
              k="Payout time"
              v="≤ 14 days after fix is live in production"
            />
            <PolicyChip
              k="Duplicates"
              v="First valid report wins · subsequent get $500 referral"
            />
          </div>
        </div>
      </section>

      {/* ── In-scope assets ───────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
          <div className="flex justify-between items-baseline mb-3.5">
            <div>
              <div
                className="eyebrow mb-1 inline-flex items-center gap-1.5"
                style={{ color: "var(--up)" }}
              >
                <span>●</span>
                <span>In scope · 4 contracts · 4,712 LOC</span>
              </div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Assets <span className="italic">in scope</span>
              </h2>
              <p className="text-ink-mute mt-1.5 m-0" style={{ fontSize: 12 }}>
                Source is open. Run forge tests against the testnet fork before submitting.
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
                Clone repo
              </button>
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
                Audit reports ↗
              </button>
            </div>
          </div>

          <div style={{ border: "1px solid var(--ink)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--ink)",
                    background: "var(--paper-alt)",
                  }}
                >
                  <Th>Contract</Th>
                  <Th>Address · explorer</Th>
                  <Th>Audit</Th>
                  <Th>Scope notes</Th>
                </tr>
              </thead>
              <tbody>
                {SCOPE_ASSETS.map((a) => (
                  <tr
                    key={a.address}
                    style={{ borderBottom: "1px solid var(--hairline-soft)" }}
                  >
                    <td style={{ padding: "14px 14px", width: "20%" }}>
                      <div
                        className="font-serif font-medium"
                        style={{ fontSize: 15, letterSpacing: "-0.015em" }}
                      >
                        {a.name}
                      </div>
                      <div
                        className="font-mono text-ink-mute mt-0.5"
                        style={{ fontSize: 10 }}
                      >
                        {a.loc}
                      </div>
                    </td>
                    <td style={{ padding: "14px 14px" }}>
                      <a
                        href={`https://explorer.testnet.chain.robinhood.com/address/${a.address}`}
                        className="font-mono no-underline text-ink"
                        style={{ fontSize: 11, fontWeight: 500 }}
                      >
                        {a.address.slice(0, 10)}…{a.address.slice(-6)}
                      </a>
                      <div
                        className="font-mono text-ink-mute mt-0.5"
                        style={{ fontSize: 9 }}
                      >
                        view on explorer ↗
                      </div>
                    </td>
                    <td style={{ padding: "14px 14px", width: "20%" }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 10,
                          padding: "2px 7px",
                          background: "var(--up-soft)",
                          color: "var(--up)",
                          border: "1px solid var(--up)",
                          borderRadius: 2,
                          letterSpacing: "0.08em",
                          fontWeight: 600,
                        }}
                      >
                        {a.audit.toUpperCase()}
                      </span>
                      <div
                        className="font-mono text-ink-mute mt-1.5"
                        style={{ fontSize: 10, lineHeight: 1.4 }}
                      >
                        {a.auditFirms.join(" · ")}
                      </div>
                    </td>
                    <td style={{ padding: "14px 14px" }}>
                      <span
                        className="text-ink-soft"
                        style={{ fontSize: 12, lineHeight: 1.5 }}
                      >
                        {a.scope}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Out of scope ──────────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-8">
            <div>
              <div
                className="eyebrow mb-1 inline-flex items-center gap-1.5"
                style={{ color: "var(--down)" }}
              >
                <span>●</span>
                <span>Out of scope</span>
              </div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                What we <span className="italic">won&apos;t</span> pay for
              </h2>
              <p
                className="text-ink-soft mt-2 m-0"
                style={{ fontSize: 12, lineHeight: 1.55 }}
              >
                Submissions of these will be marked invalid and closed. They do not count against
                your validity ratio if it&apos;s your first one, but repeats will lead to
                program-level rate limiting.
              </p>
            </div>
            <ul
              className="list-none p-0 m-0"
              style={{ border: "1px solid var(--hairline)" }}
            >
              {OUT_OF_SCOPE.map((item, i) => (
                <li
                  key={i}
                  className="flex gap-3"
                  style={{
                    padding: "11px 14px",
                    borderBottom:
                      i < OUT_OF_SCOPE.length - 1
                        ? "1px dashed var(--hairline-soft)"
                        : undefined,
                  }}
                >
                  <span
                    className="font-mono text-ink-mute shrink-0"
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      paddingTop: 2,
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.5 }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Submission process ────────────────────────────── */}
      <SubmissionProcess
        encrypting={encrypting}
        onSimulate={() => {
          setEncrypting(true);
          setTimeout(() => setEncrypting(false), 1400);
        }}
      />

      {/* ── Hall of fame ──────────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
          <div className="flex justify-between items-baseline mb-3.5">
            <div>
              <div className="eyebrow mb-1">Hall of fame · paid researchers</div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Top researchers
              </h2>
              <p className="text-ink-mute mt-1.5 m-0" style={{ fontSize: 12 }}>
                Names appear with researcher consent only. Anonymous payouts are routed via
                Immunefi and not listed here.
              </p>
            </div>
            <span className="font-mono text-ink-mute" style={{ fontSize: 10 }}>
              by lifetime payout
            </span>
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
                  <Th>Rank</Th>
                  <Th>Researcher</Th>
                  <Th align="right">Lifetime payout</Th>
                  <Th align="right">Valid reports</Th>
                  <Th>Highest finding</Th>
                </tr>
              </thead>
              <tbody>
                {HALL_OF_FAME.map((r) => (
                  <tr
                    key={r.handle}
                    style={{ borderBottom: "1px dashed var(--hairline-soft)" }}
                  >
                    <td style={{ padding: "12px 14px" }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 11,
                          padding: "2px 7px",
                          borderRadius: 2,
                          background: r.rank === 1 ? "var(--ink)" : "var(--paper-alt)",
                          color: r.rank === 1 ? "var(--paper)" : "var(--ink-soft)",
                          fontWeight: 600,
                          letterSpacing: "0.04em",
                        }}
                      >
                        #{r.rank}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span
                        className="font-mono"
                        style={{ fontSize: 13, fontWeight: 500 }}
                      >
                        {r.handle}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "right" }}>
                      <span
                        className="font-serif font-medium tabular"
                        style={{
                          fontSize: 15,
                          letterSpacing: "-0.02em",
                          color: "var(--up)",
                        }}
                      >
                        {fmtUsdShort(r.payouts)}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "right" }}>
                      <span className="font-mono tabular" style={{ fontSize: 12 }}>
                        {r.reports}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span
                        className="text-ink-soft"
                        style={{ fontSize: 12 }}
                      >
                        {r.highest}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Vulnerability disclosure policy ───────────────── */}
      <section className="border-b border-hairline bg-paper-alt">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-8 items-start">
            <div>
              <div className="eyebrow mb-1">Disclosure policy · v2.1</div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Safe harbor for <span className="italic">good-faith</span> research
              </h2>
              <p
                className="text-ink-soft mt-2 m-0"
                style={{ fontSize: 12, lineHeight: 1.55 }}
              >
                We follow the Immunefi standard. Researchers who act in good faith and within
                scope have full legal protection from EquiFlow Labs and the DAO, and will be
                indemnified against third-party claims arising from their disclosure.
              </p>
            </div>
            <blockquote
              className="font-serif m-0"
              style={{
                padding: "22px 28px",
                background: "var(--paper)",
                borderLeft: "3px solid var(--ink)",
                fontSize: 15,
                lineHeight: 1.7,
                letterSpacing: "-0.005em",
                color: "var(--ink-soft)",
                fontStyle: "italic",
              }}
            >
              <p className="m-0">
                EquiFlow Labs, the EquiFlow DAO, and any subsidiary will not initiate or support
                legal action against security researchers acting in good faith under this policy.
                We grant you safe harbor for: accessing testnet contracts, transferring no more
                value than necessary to demonstrate the issue, and disclosing in private to our
                triage team first.
              </p>
              <p className="m-0 mt-4">
                In exchange, we ask that you do not publicly disclose a vulnerability before a fix
                is live in production, do not attempt to access or modify another user&apos;s funds
                beyond what is strictly necessary for a proof of concept, and do not exploit the
                bug for personal gain. Sharing the vulnerability with any third party before
                disclosure forfeits your reward.
              </p>
              <footer
                className="font-mono not-italic mt-5"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  color: "var(--ink-mute)",
                }}
              >
                — EQUIFLOW DAO · GOVERNANCE PROPOSAL EQUI-0024 · RATIFIED 2026-02-11
              </footer>
            </blockquote>
          </div>
        </div>
      </section>

      {/* ── Recent reports ────────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-6">
          <div className="flex justify-between items-baseline mb-3.5">
            <div>
              <div className="eyebrow mb-1">Recent reports · 90-day window</div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Recent <span className="italic">disclosures</span>
              </h2>
              <p className="text-ink-mute mt-1.5 m-0" style={{ fontSize: 12 }}>
                Live reports are redacted until a fix is shipped. Resolved reports include the
                full root-cause analysis once disclosed.
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
                  <Th>Submitted</Th>
                  <Th>Severity</Th>
                  <Th>Title</Th>
                  <Th>Status</Th>
                  <Th>Researcher</Th>
                  <Th align="right">Reward</Th>
                </tr>
              </thead>
              <tbody>
                {RECENT_REPORTS.map((r) => (
                  <tr
                    key={r.id}
                    style={{ borderBottom: "1px solid var(--hairline-soft)" }}
                  >
                    <td style={{ padding: "12px 14px" }}>
                      <span
                        className="font-mono"
                        style={{ fontSize: 11, fontWeight: 500 }}
                      >
                        {r.id}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span
                        className="font-mono text-ink-mute"
                        style={{ fontSize: 11 }}
                      >
                        {r.date}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      {r.severity === "—" ? (
                        <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>
                          —
                        </span>
                      ) : (
                        <SeverityBadge severity={r.severity} />
                      )}
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      {r.redacted ? (
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 11,
                            color: "var(--ink-mute)",
                            background: "var(--paper-alt)",
                            padding: "3px 8px",
                            border: "1px dashed var(--hairline)",
                            letterSpacing: "0.08em",
                          }}
                        >
                          ███ CONFIDENTIAL · IN TRIAGE ███
                        </span>
                      ) : (
                        <span style={{ fontSize: 12 }}>{r.title}</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <ReportStatus status={r.status} />
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 11,
                          color: r.redacted ? "var(--ink-mute)" : "var(--ink-soft)",
                        }}
                      >
                        {r.researcher}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "right" }}>
                      {r.reward != null ? (
                        <span
                          className="font-mono tabular font-medium"
                          style={{ fontSize: 12, color: "var(--up)" }}
                        >
                          +{fmtUsdShort(r.reward)}
                        </span>
                      ) : (
                        <span className="font-mono text-ink-mute" style={{ fontSize: 11 }}>
                          pending
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */

function SubmissionProcess({
  encrypting,
  onSimulate,
}: {
  encrypting: boolean;
  onSimulate: () => void;
}) {
  const steps = [
    {
      n: "01",
      title: "Research",
      body: "Fork the testnet, run the forge suite, identify a violated invariant. We publish the full invariant list in docs/SECURITY.md — every one of them is a paid finding if you break it.",
    },
    {
      n: "02",
      title: "Encrypt PoC",
      body: "Bundle the PoC, root-cause writeup, and fix recommendation. Encrypt under the EquiFlow Labs PGP key (fingerprint 4A2C 91DE … 9013). Plaintext disclosures are not accepted.",
    },
    {
      n: "03",
      title: "Submit via Immunefi",
      body: "File the encrypted payload at immunefi.com/bounty/equiflow. Include a Robinhood Chain testnet tx hash demonstrating the exploit. Optional: anonymous handle for payout.",
    },
    {
      n: "04",
      title: "Triage",
      body: "We acknowledge within 24h, propose a severity within 72h, and pay within 14 days of fix-deploy. You get final approval on the public writeup. Confidential indefinitely if you prefer.",
    },
  ];
  return (
    <section className="border-t border-ink bg-paper-alt">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8">
        <div className="mb-5">
          <div className="eyebrow mb-1.5">How to submit · four steps</div>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: 22, letterSpacing: "-0.025em" }}
          >
            From a broken invariant to a <span className="italic">paid reward</span>.
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

        <div
          className="mt-4 flex items-center justify-between gap-4 flex-wrap"
          style={{
            padding: "14px 18px",
            background: "var(--ink)",
            color: "var(--paper)",
            borderRadius: 2,
          }}
        >
          <div className="flex items-center gap-3.5">
            <span
              className="font-mono"
              style={{ fontSize: 10, opacity: 0.6, letterSpacing: "0.14em" }}
            >
              READY TO SUBMIT?
            </span>
            <span className="font-mono" style={{ fontSize: 12 }}>
              security@equiflow.xyz · PGP 4A2C 91DE 7F4B C821 9013 5E0A
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onSimulate}
              disabled={encrypting}
              className="font-medium inline-flex items-center gap-2"
              style={{
                padding: "8px 14px",
                fontSize: 12,
                background: "transparent",
                color: "var(--paper)",
                border: "1px solid rgba(250, 248, 242, 0.3)",
                borderRadius: 2,
                opacity: encrypting ? 0.7 : 1,
              }}
            >
              <span
                className="inline-block"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: encrypting ? "var(--amber)" : "var(--up)",
                  animation: encrypting ? "ef-pulse 1.4s ease-out infinite" : "none",
                }}
              />
              {encrypting ? "Encrypting…" : "Download PGP key"}
            </button>
            <button
              className="font-medium"
              style={{
                padding: "8px 14px",
                fontSize: 12,
                background: "var(--paper)",
                color: "var(--ink)",
                border: "none",
                borderRadius: 2,
              }}
            >
              Submit on Immunefi ↗
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const map: Record<Severity, { bg: string; fg: string; border: string }> = {
    Critical: { bg: "var(--down-soft)", fg: "var(--down)", border: "var(--down)" },
    High: { bg: "var(--down-soft)", fg: "var(--down)", border: "var(--down)" },
    Medium: { bg: "var(--amber-soft)", fg: "var(--amber)", border: "var(--amber)" },
    Low: { bg: "var(--amber-soft)", fg: "var(--amber)", border: "var(--amber)" },
    Informational: { bg: "var(--paper-alt)", fg: "var(--ink-soft)", border: "var(--hairline)" },
  };
  const c = map[severity];
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
      {severity.toUpperCase()}
    </span>
  );
}

function ReportStatus({
  status,
}: {
  status: "RESOLVED" | "IN TRIAGE" | "DISCLOSED" | "DUPLICATE";
}) {
  const map = {
    RESOLVED: { bg: "var(--up-soft)", fg: "var(--up)", border: "var(--up)" },
    "IN TRIAGE": { bg: "var(--amber-soft)", fg: "var(--amber)", border: "var(--amber)" },
    DISCLOSED: { bg: "var(--paper-alt)", fg: "var(--ink-soft)", border: "var(--hairline)" },
    DUPLICATE: { bg: "var(--paper-alt)", fg: "var(--ink-mute)", border: "var(--hairline)" },
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

function PolicyChip({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        padding: "10px 14px",
        background: "var(--paper)",
      }}
    >
      <div className="eyebrow mb-1">{k}</div>
      <div className="font-mono" style={{ fontSize: 12, lineHeight: 1.45 }}>
        {v}
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
