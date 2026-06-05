"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";

type Severity = "critical" | "high" | "medium" | "low" | "informational";
type Status = "resolved" | "acknowledged" | "wont-fix";

type Finding = {
  sev: Severity;
  count: number;
  resolved: number;
  acknowledged: number;
};

type Audit = {
  firm: string;
  firmTag: string;
  date: string;
  duration: string;
  commit: string;
  scope: string[];
  loc: number;
  reportUrl: string;
  findings: Finding[];
  reviewers: string[];
  blurb: string;
};

const AUDITS: Audit[] = [
  {
    firm: "Trail of Bits",
    firmTag: "TOB",
    date: "12 Feb 2026",
    duration: "5 weeks · 3 reviewers",
    commit: "a47c2f9",
    scope: [
      "contracts/Vault.sol",
      "contracts/USDG.sol",
      "contracts/PythPriceAdapter.sol",
      "contracts/InterestRateModel.sol",
    ],
    loc: 3_482,
    reportUrl: "https://github.com/trailofbits/publications/equiflow-v0.3.pdf",
    findings: [
      { sev: "critical", count: 1, resolved: 1, acknowledged: 0 },
      { sev: "high", count: 3, resolved: 3, acknowledged: 0 },
      { sev: "medium", count: 7, resolved: 6, acknowledged: 1 },
      { sev: "low", count: 11, resolved: 9, acknowledged: 2 },
      { sev: "informational", count: 18, resolved: 12, acknowledged: 6 },
    ],
    reviewers: ["Sam Sun", "M. Tjaden", "K. Reyes"],
    blurb:
      "Manual review of the v0.3 vault, USDG mint/burn paths, and the Pyth adapter. The critical finding (since fixed) was a missing decimals normalization in the LTV calculation that under-collateralized 8-decimal feeds by ~10⁻¹⁰.",
  },
  {
    firm: "OpenZeppelin",
    firmTag: "OZ",
    date: "31 Mar 2026",
    duration: "4 weeks · 2 reviewers",
    commit: "b29e144",
    scope: [
      "contracts/Vault.sol (delta from TOB)",
      "contracts/SimpleAccountFactory.sol",
      "contracts/governance/Timelock.sol",
      "contracts/EOAValidator.sol",
    ],
    loc: 1_874,
    reportUrl: "https://blog.openzeppelin.com/equiflow-audit-march-2026/",
    findings: [
      { sev: "critical", count: 0, resolved: 0, acknowledged: 0 },
      { sev: "high", count: 2, resolved: 2, acknowledged: 0 },
      { sev: "medium", count: 5, resolved: 4, acknowledged: 1 },
      { sev: "low", count: 8, resolved: 7, acknowledged: 1 },
      { sev: "informational", count: 14, resolved: 9, acknowledged: 5 },
    ],
    reviewers: ["J. Rivero", "F. Cardelli"],
    blurb:
      "Targeted review of the EIP-7702 delegate path and the new timelock-gated governance. Two highs were about the EOAValidator accepting expired session keys; both patched before mainnet candidate cut.",
  },
  {
    firm: "Spearbit",
    firmTag: "SPEAR",
    date: "08 May 2026",
    duration: "3 weeks · 4 reviewers (crowd)",
    commit: "c1f8a02",
    scope: [
      "contracts/Vault.sol (final pass)",
      "contracts/Liquidator.sol",
      "contracts/Treasury.sol",
      "contracts/StablecoinAdapter.sol",
    ],
    loc: 2_106,
    reportUrl: "https://spearbit.com/portfolio/equiflow-v042.pdf",
    findings: [
      { sev: "critical", count: 0, resolved: 0, acknowledged: 0 },
      { sev: "high", count: 1, resolved: 1, acknowledged: 0 },
      { sev: "medium", count: 4, resolved: 4, acknowledged: 0 },
      { sev: "low", count: 6, resolved: 5, acknowledged: 1 },
      { sev: "informational", count: 9, resolved: 6, acknowledged: 3 },
    ],
    reviewers: ["pashov", "0xRajeev", "alex-ppg", "spearbit-team"],
    blurb:
      "Crowd review on the final v0.4.2 release candidate. The high was a rounding direction in partial-repay that, in adversarial conditions, could leave 1 wei of debt and block close-out — fixed and tested. Followed by seven in-house tightening passes on the road to v0.5.0 — see history below.",
  },
];

const SEV_TONE: Record<Severity, { fg: string; bg: string; label: string }> = {
  critical: { fg: "var(--down)", bg: "var(--down-soft)", label: "Critical" },
  high: { fg: "var(--down)", bg: "var(--down-soft)", label: "High" },
  medium: { fg: "var(--amber)", bg: "var(--amber-soft)", label: "Medium" },
  low: { fg: "var(--ink-soft)", bg: "var(--paper-alt)", label: "Low" },
  informational: { fg: "var(--ink-mute)", bg: "var(--paper-alt)", label: "Info" },
};

const POSTURE = [
  {
    tag: "FORMAL",
    title: "Formal verification",
    body: "Solvency and HF invariants discharged in Certora Prover. Coverage: 87% of state-changing functions in Vault.sol, 100% of USDG mint/burn.",
    metric: "87% · 41 rules",
  },
  {
    tag: "FUZZ",
    title: "Fuzzing coverage",
    body: "Echidna + Foundry invariant suites running on CI on every PR. 92.4% branch coverage on the risk-engine modules. 4.2B sequences executed cumulatively.",
    metric: "92.4% branches",
  },
  {
    tag: "BOUNTY",
    title: "Bug bounty",
    body: "Live on Immunefi with a max payout of $1M for critical impact (loss of funds / mint authorization). $1.41M paid YTD since v0.1.",
    metric: "$1M cap",
  },
  {
    tag: "MONITOR",
    title: "Monitoring partner",
    body: "Forta agents watching for: oracle deviation > 0.5%, large withdraws (> 5% TVL/block), governance timelock queue, and unusual liquidator behavior.",
    metric: "Forta · 14 agents",
  },
];

const HISTORY = [
  { ver: "v0.1.0", date: "Aug 2025", note: "Internal review · pre-public" },
  { ver: "v0.3.0", date: "Feb 2026", note: "Trail of Bits · 1 crit (fixed)" },
  { ver: "v0.4.0", date: "Mar 2026", note: "OpenZeppelin · 0 crit · 2 high" },
  { ver: "v0.4.2", date: "May 2026", note: "Spearbit · 0 crit · 1 high" },
  { ver: "v0.5.0", date: "May 2026", note: "Internal · 7 rounds · 0 crit · 0 high · 0 medium (current)" },
];

export default function AuditsPage() {
  const totals = useMemo(() => {
    const t = { critical: 0, high: 0, medium: 0, low: 0, informational: 0, resolved: 0, all: 0 };
    for (const a of AUDITS) {
      for (const f of a.findings) {
        t[f.sev] += f.count;
        t.resolved += f.resolved;
        t.all += f.count;
      }
    }
    return t;
  }, []);

  const resolvedPct = useMemo(
    () => (totals.all === 0 ? 100 : (totals.resolved / totals.all) * 100),
    [totals],
  );

  return (
    <div className="flex flex-col min-h-screen">
      <PageNav />

      <div
        className="border-b border-hairline-soft"
        style={{ padding: "12px 32px", background: "var(--amber-soft)" }}
      >
        <span style={{ fontSize: 12, letterSpacing: "0.06em" }} className="text-ink-soft font-mono uppercase">
          ILLUSTRATIVE · Audit data shown is for demonstration purposes only. No audits have been completed.
        </span>
      </div>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="border-b border-ink">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-7 pb-6">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <div className="eyebrow mb-2 inline-flex items-center gap-2">
                <span style={{ color: "var(--up)" }}>●</span>
                <span>
                  Security · {AUDITS.length} external audits · 0 unresolved critical
                </span>
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
                Three firms, twelve weeks, {totals.all} findings.{" "}
                <span className="italic">All criticals closed.</span>
              </h1>
              <p
                className="text-ink-soft mt-2.5 max-w-[660px] m-0"
                style={{ fontSize: 13.5, lineHeight: 1.55 }}
              >
                Every contract in production at v0.5.0 has been reviewed by at
                least two of the three firms below and tightened across seven
                in-house follow-up passes. Reports, commit hashes, and
                remediation evidence are public.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div
                className="font-mono text-ink-mute"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                RESOLUTION RATE
              </div>
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 26, letterSpacing: "-0.02em", color: "var(--up)" }}
              >
                {resolvedPct.toFixed(1)}%
              </div>
              <div
                className="font-mono text-ink-mute mt-1"
                style={{ fontSize: 10 }}
              >
                {totals.resolved} of {totals.all} closed
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <section className="bg-paper-alt border-b border-hairline">
        <div className="max-w-[1320px] mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {[
            ["Critical", String(totals.critical), "all resolved · 0 open", "var(--down)"],
            ["High", String(totals.high), "all resolved · 0 open", "var(--down)"],
            ["Medium", String(totals.medium), `${AUDITS.reduce((a, x) => a + (x.findings.find((f) => f.sev === "medium")?.acknowledged ?? 0), 0)} acknowledged`, "var(--amber)"],
            ["Low", String(totals.low), "non-blocking", "var(--ink-soft)"],
            ["Informational", String(totals.informational), "style + best-practice", "var(--ink-mute)"],
          ].map(([label, val, sub, color], i) => (
            <div
              key={label}
              style={{
                padding: "18px 24px",
                borderRight: i < 4 ? "1px solid var(--hairline-soft)" : undefined,
              }}
            >
              <div className="eyebrow mb-2.5">{label}</div>
              <div
                className="font-serif font-medium tabular"
                style={{
                  fontSize: 30,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                  color: color as string,
                }}
              >
                {val}
              </div>
              <div
                className="font-mono tabular text-ink-mute mt-2"
                style={{ fontSize: 10 }}
              >
                {sub}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Audit cards ───────────────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-9">
          <div className="mb-6">
            <div className="eyebrow mb-1.5">External audits</div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 26, letterSpacing: "-0.025em" }}
            >
              Three independent reviews
            </h2>
            <p
              className="text-ink-soft mt-2 m-0 max-w-[640px]"
              style={{ fontSize: 13, lineHeight: 1.55 }}
            >
              Sequential, not parallel — each engagement built on the
              remediation evidence of the previous one. Spearbit was the final
              crowd-review on the mainnet candidate.
            </p>
          </div>

          <div className="grid gap-5">
            {AUDITS.map((a, i) => (
              <AuditCard key={a.firm} audit={a} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Security posture ──────────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-10">
          <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
            <div>
              <div className="eyebrow mb-1.5">Security posture</div>
              <h2
                className="font-serif font-medium m-0"
                style={{ fontSize: 26, letterSpacing: "-0.025em" }}
              >
                Beyond audits · the <span className="italic">continuous</span> layer
              </h2>
              <p
                className="text-ink-soft mt-2 m-0 max-w-[640px]"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                Audits are point-in-time. Day-to-day safety is enforced by
                formal proofs, fuzz suites, a live bug bounty, and Forta
                monitoring.
              </p>
            </div>
            <Link
              href="/bug-bounty"
              className="font-medium no-underline inline-flex items-center gap-2"
              style={{
                padding: "10px 16px",
                fontSize: 13,
                background: "var(--ink)",
                color: "var(--paper)",
                borderRadius: 2,
              }}
            >
              Open bug bounty
              <span className="font-mono" style={{ fontSize: 10, opacity: 0.7 }}>→</span>
            </Link>
          </div>

          <div
            className="grid grid-cols-2 sm:grid-cols-4"
            style={{ border: "1px solid var(--hairline)" }}
          >
            {POSTURE.map((p, i) => (
              <div
                key={p.tag}
                className="bg-paper"
                style={{
                  padding: "22px 22px",
                  borderRight: i < POSTURE.length - 1 ? "1px solid var(--hairline)" : undefined,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
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
                    {p.tag}
                  </span>
                </div>
                <h4
                  className="font-serif font-medium m-0"
                  style={{ fontSize: 17, letterSpacing: "-0.02em" }}
                >
                  {p.title}
                </h4>
                <p
                  className="text-ink-soft mt-2 m-0"
                  style={{ fontSize: 12.5, lineHeight: 1.6 }}
                >
                  {p.body}
                </p>
                <div
                  className="mt-3.5 font-mono tabular font-medium"
                  style={{
                    fontSize: 13,
                    color: "var(--ink)",
                    paddingTop: 10,
                    borderTop: "1px dashed var(--hairline)",
                  }}
                >
                  {p.metric}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Audit history timeline ────────────────────────────── */}
      <section className="border-b border-hairline">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-10">
          <div className="mb-5">
            <div className="eyebrow mb-1.5">Audit history</div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Every protocol version, every review
            </h2>
          </div>
          <div
            className="bg-paper-alt"
            style={{ padding: "26px 28px", border: "1px solid var(--hairline)" }}
          >
            <Timeline />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 mt-6">
              {HISTORY.map((h, i) => (
                <div
                  key={h.ver}
                  style={{
                    padding: "0 16px",
                    borderRight: i < HISTORY.length - 1 ? "1px solid var(--hairline-soft)" : undefined,
                  }}
                >
                  <div
                    className="font-mono font-medium tabular"
                    style={{ fontSize: 13, letterSpacing: "0.04em" }}
                  >
                    {h.ver}
                  </div>
                  <div
                    className="font-mono text-ink-mute mt-1"
                    style={{ fontSize: 10, letterSpacing: "0.06em" }}
                  >
                    {h.date.toUpperCase()}
                  </div>
                  <div
                    className="text-ink-soft mt-2"
                    style={{ fontSize: 12, lineHeight: 1.4 }}
                  >
                    {h.note}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer disclosure CTA ─────────────────────────────── */}
      <section className="border-t border-ink bg-paper-alt">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-10">
          <div className="grid grid-cols-[1.4fr_1fr] gap-6 items-center">
            <div>
              <div className="eyebrow mb-2">Responsible disclosure</div>
              <h3
                className="font-serif font-medium m-0"
                style={{ fontSize: 22, letterSpacing: "-0.025em" }}
              >
                Found something? <span className="italic">Tell us first.</span>
              </h3>
              <p
                className="text-ink-soft mt-2.5 m-0 max-w-[640px]"
                style={{ fontSize: 13, lineHeight: 1.6 }}
              >
                Email security@equiflow.xyz or submit via Immunefi. We commit
                to a 24-hour first response, a triage decision within 72 hours,
                and a public CVE within 90 days of the fix shipping. We do not
                pursue legal action against good-faith researchers.
              </p>
            </div>
            <div className="text-right">
              <div
                className="font-mono inline-block"
                style={{
                  fontSize: 11,
                  padding: "10px 14px",
                  background: "var(--paper)",
                  border: "1px solid var(--hairline)",
                  color: "var(--ink-soft)",
                  marginBottom: 12,
                }}
              >
                security@equiflow.xyz
              </div>
              <div>
                <button
                  className="font-medium"
                  style={{
                    padding: "10px 16px",
                    fontSize: 13,
                    background: "var(--ink)",
                    color: "var(--paper)",
                    border: "none",
                    borderRadius: 2,
                  }}
                >
                  Submit via Immunefi <span style={{ opacity: 0.7 }}>↗</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

function AuditCard({ audit, index }: { audit: Audit; index: number }) {
  const totalFound = audit.findings.reduce((s, f) => s + f.count, 0);
  const totalResolved = audit.findings.reduce((s, f) => s + f.resolved, 0);
  const unresolvedHi = audit.findings
    .filter((f) => f.sev === "critical" || f.sev === "high")
    .reduce((s, f) => s + (f.count - f.resolved), 0);

  return (
    <div
      style={{
        border: "1px solid var(--ink)",
        background: "var(--paper)",
      }}
    >
      {/* Header strip */}
      <div
        className="grid grid-cols-[1fr_auto] items-center gap-6"
        style={{
          padding: "18px 24px",
          background: "var(--paper-alt)",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <div className="flex items-center gap-5">
          <span
            className="font-mono font-medium"
            style={{
              fontSize: 11,
              padding: "4px 9px",
              background: "var(--ink)",
              color: "var(--paper)",
              letterSpacing: "0.14em",
            }}
          >
            #0{index + 1} · {audit.firmTag}
          </span>
          <div>
            <h3
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              {audit.firm}
            </h3>
            <div
              className="font-mono text-ink-mute mt-1"
              style={{ fontSize: 11, letterSpacing: "0.06em" }}
            >
              {audit.date.toUpperCase()} · {audit.duration} · commit {audit.commit}
            </div>
          </div>
        </div>
        <div className="flex gap-3 items-center">
          <span
            className="font-mono inline-flex items-center gap-1.5"
            style={{
              fontSize: 11,
              padding: "5px 10px",
              background: unresolvedHi === 0 ? "var(--up-soft)" : "var(--amber-soft)",
              border: `1px solid ${unresolvedHi === 0 ? "var(--up)" : "var(--amber)"}`,
              color: unresolvedHi === 0 ? "var(--up)" : "var(--amber)",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            <span>●</span>
            {unresolvedHi === 0 ? "All criticals + highs closed" : `${unresolvedHi} high open`}
          </span>
          <a
            href={audit.reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium no-underline inline-flex items-center gap-2"
            style={{
              padding: "8px 14px",
              fontSize: 12,
              background: "var(--ink)",
              color: "var(--paper)",
              borderRadius: 2,
            }}
          >
            View full report ↗
          </a>
        </div>
      </div>

      {/* Body */}
      <div className="grid grid-cols-[1.4fr_1fr]">
        <div
          style={{
            padding: "22px 24px",
            borderRight: "1px solid var(--hairline)",
          }}
        >
          <div className="eyebrow mb-2.5">Scope</div>
          <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
            {audit.scope.map((s) => (
              <li
                key={s}
                className="font-mono"
                style={{
                  fontSize: 12,
                  padding: "5px 9px",
                  background: "var(--paper-alt)",
                  borderLeft: "2px solid var(--ink-mute)",
                }}
              >
                {s}
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-3 mt-5">
            <div>
              <div className="eyebrow mb-1">Lines of code</div>
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 18, letterSpacing: "-0.02em" }}
              >
                {audit.loc.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="eyebrow mb-1">Findings</div>
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 18, letterSpacing: "-0.02em" }}
              >
                {totalFound}
              </div>
            </div>
            <div>
              <div className="eyebrow mb-1">Resolved</div>
              <div
                className="font-serif font-medium tabular"
                style={{
                  fontSize: 18,
                  letterSpacing: "-0.02em",
                  color: "var(--up)",
                }}
              >
                {totalResolved} / {totalFound}
              </div>
            </div>
          </div>

          <p
            className="text-ink-soft mt-5 m-0"
            style={{ fontSize: 12.5, lineHeight: 1.65 }}
          >
            {audit.blurb}
          </p>

          <div className="eyebrow mt-5 mb-1.5">Reviewers</div>
          <div className="flex gap-1.5 flex-wrap">
            {audit.reviewers.map((r) => (
              <span
                key={r}
                className="font-mono"
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  border: "1px solid var(--hairline)",
                  color: "var(--ink-soft)",
                }}
              >
                {r}
              </span>
            ))}
          </div>
        </div>

        <div style={{ padding: "22px 24px" }}>
          <div className="eyebrow mb-3">Findings by severity</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ink)" }}>
                <th
                  className="font-medium text-ink-mute uppercase"
                  style={{
                    padding: "8px 6px",
                    textAlign: "left",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                  }}
                >
                  Severity
                </th>
                <th
                  className="font-medium text-ink-mute uppercase"
                  style={{
                    padding: "8px 6px",
                    textAlign: "right",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                  }}
                >
                  Found
                </th>
                <th
                  className="font-medium text-ink-mute uppercase"
                  style={{
                    padding: "8px 6px",
                    textAlign: "right",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                  }}
                >
                  Resolved
                </th>
                <th
                  className="font-medium text-ink-mute uppercase"
                  style={{
                    padding: "8px 6px",
                    textAlign: "right",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                  }}
                >
                  Ack
                </th>
                <th
                  className="font-medium text-ink-mute uppercase"
                  style={{
                    padding: "8px 6px",
                    textAlign: "left",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                  }}
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {audit.findings.map((f) => {
                const tone = SEV_TONE[f.sev];
                const fullyResolved = f.resolved === f.count;
                const status: { label: string; tone: string } = fullyResolved
                  ? { label: "Resolved", tone: "var(--up)" }
                  : f.acknowledged > 0
                    ? { label: "Acknowledged", tone: "var(--amber)" }
                    : { label: "In review", tone: "var(--ink-mute)" };
                return (
                  <tr
                    key={f.sev}
                    style={{ borderBottom: "1px dashed var(--hairline-soft)" }}
                  >
                    <td style={{ padding: "10px 6px" }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 11,
                          padding: "3px 8px",
                          background: tone.bg,
                          color: tone.fg,
                          letterSpacing: "0.08em",
                          fontWeight: 600,
                        }}
                      >
                        {tone.label}
                      </span>
                    </td>
                    <td
                      style={{ padding: "10px 6px", textAlign: "right" }}
                      className="font-mono tabular"
                    >
                      {f.count}
                    </td>
                    <td
                      style={{
                        padding: "10px 6px",
                        textAlign: "right",
                        color: f.resolved === f.count ? "var(--up)" : "var(--ink)",
                      }}
                      className="font-mono tabular font-medium"
                    >
                      {f.resolved}
                    </td>
                    <td
                      style={{ padding: "10px 6px", textAlign: "right" }}
                      className="font-mono tabular text-ink-mute"
                    >
                      {f.acknowledged}
                    </td>
                    <td style={{ padding: "10px 6px" }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 10.5,
                          color: status.tone,
                          letterSpacing: "0.06em",
                        }}
                      >
                        ● {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div
            className="mt-4"
            style={{
              padding: "12px 14px",
              background: "var(--paper-alt)",
              border: "1px solid var(--hairline-soft)",
            }}
          >
            <div className="flex justify-between items-center">
              <div className="eyebrow">Resolution</div>
              <div
                className="font-mono tabular font-medium"
                style={{ fontSize: 12, color: "var(--up)" }}
              >
                {((totalResolved / totalFound) * 100).toFixed(1)}%
              </div>
            </div>
            <div
              className="mt-2"
              style={{ height: 4, background: "var(--hairline-soft)" }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(totalResolved / totalFound) * 100}%`,
                  background: "var(--up)",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Timeline() {
  const W = 1180;
  const H = 100;
  const xs = HISTORY.map((_, i) => 60 + i * ((W - 120) / (HISTORY.length - 1)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      <line
        x1={xs[0]}
        x2={xs[xs.length - 1]}
        y1={50}
        y2={50}
        stroke="var(--ink)"
        strokeWidth="1"
      />
      {HISTORY.map((h, i) => {
        const isCurrent = i === HISTORY.length - 1;
        return (
          <g key={h.ver}>
            <circle
              cx={xs[i]}
              cy={50}
              r={isCurrent ? 9 : 6}
              fill={isCurrent ? "var(--ink)" : "var(--paper)"}
              stroke="var(--ink)"
              strokeWidth="1.5"
            />
            <text
              x={xs[i]}
              y={30}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="11"
              fill="var(--ink)"
              fontWeight={isCurrent ? 600 : 500}
              letterSpacing="0.06em"
            >
              {h.ver}
            </text>
            <text
              x={xs[i]}
              y={75}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="10"
              fill="var(--ink-mute)"
              letterSpacing="0.06em"
            >
              {h.date.toUpperCase()}
            </text>
            {isCurrent && (
              <text
                x={xs[i]}
                y={92}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="9"
                fill="var(--up)"
                letterSpacing="0.1em"
                fontWeight="600"
              >
                ● CURRENT
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
