"use client";

import { useState } from "react";
import Link from "next/link";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";

const INSTALL_CMD = "pnpm add @equiflow/sdk viem";

const QUICKSTART = [
  {
    n: "01",
    title: "Install the SDK and viem",
    blurb:
      "Tree-shakeable ESM. The SDK depends on viem for transport but does not pin a version.",
    code: `pnpm add @equiflow/sdk viem
# or
npm i @equiflow/sdk viem
# or
bun add @equiflow/sdk viem`,
  },
  {
    n: "02",
    title: "Initialise a client",
    blurb:
      "createClient binds the SDK to a chain, an RPC, and (optionally) a paymaster URL for gas-sponsored ops.",
    code: `import { createEquiFlowClient } from "@equiflow/sdk";
import { robinhoodChainTestnet } from "@equiflow/sdk/chains";

export const ef = createEquiFlowClient({
  chain: robinhoodChainTestnet,
  transport: "https://rpc.testnet.chain.robinhood.com",
  paymaster: "https://gas.equiflow.io/v1/userop",
});`,
  },
  {
    n: "03",
    title: "Pledge and borrow",
    blurb:
      "One call. The SDK assembles approve + pledgeAndBorrow into a single UserOperation when a paymaster is configured.",
    code: `import { parseUnits } from "viem";

const receipt = await ef.vault.pledge({
  account: wallet,
  token: "TSLA",
  amount: parseUnits("12.5", 18),
  borrowUsd: parseUnits("3200", 18),
});

console.log(receipt.txHash, receipt.healthFactor.toString());`,
  },
  {
    n: "04",
    title: "Handle the receipt",
    blurb:
      "Receipts contain the on-chain tx hash, the new position snapshot, and (when AA was used) the bundler hash.",
    code: `if (receipt.status === "sealed") {
  toast.success(\`Borrowed \${formatUsd(receipt.borrowedUsd)}\`);
  router.push(\`/positions\`);
} else if (receipt.status === "reverted") {
  console.error(receipt.error); // typed: ExceedsLtv | StalePrice | ...
}`,
  },
];

const EXAMPLES = [
  {
    id: "pledge",
    label: "Pledge & borrow",
    desc:
      "Pledge tokenized equity and mint USDG in a single signature. Falls back to two calls when no paymaster is configured.",
    code: `import { createEquiFlowClient } from "@equiflow/sdk";
import { robinhoodChainTestnet } from "@equiflow/sdk/chains";
import { privateKeyToAccount } from "viem/accounts";
import { parseUnits } from "viem";

const ef = createEquiFlowClient({
  chain: robinhoodChainTestnet,
  transport: process.env.RBN_RPC_URL!,
  paymaster: process.env.EF_PAYMASTER_URL!,
});

const account = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);

const receipt = await ef.vault.pledge({
  account,
  token: "TSLA",
  amount: parseUnits("12.5", 18),
  borrowUsd: parseUnits("3200", 18),
  slippageBps: 25,
});

if (receipt.status !== "sealed") throw new Error(receipt.error?.name);

console.log({
  tx: receipt.txHash,
  hf: receipt.healthFactor.toString(),
  borrowed: receipt.borrowedUsd.toString(),
  userOp: receipt.userOpHash, // undefined when no paymaster
});`,
  },
  {
    id: "liquidate",
    label: "Liquidation scanner",
    desc:
      "Stream the at-risk set and front-run any HF < 1 candidate. Backed by the same indexer the dashboard uses.",
    code: `import { createEquiFlowClient } from "@equiflow/sdk";

const ef = createEquiFlowClient({ chain: robinhoodChainTestnet });

const stream = ef.liquidations.watch({
  hfMax: 1.05,         // include positions still in the watch zone
  minDebtUsd: 1_000,   // skip dust
  poll: 4_000,         // ms — null = subscribe via websocket
});

for await (const candidate of stream) {
  if (candidate.hf >= 1) continue;

  const sim = await ef.vault.simulateLiquidate({
    user: candidate.user,
    token: candidate.bestCollateral,
    debtUsd: candidate.maxRepayUsd,
  });

  if (sim.profitUsd < 5) continue; // ignore unprofitable

  await ef.vault.liquidate({
    account,
    user: candidate.user,
    token: candidate.bestCollateral,
    debtUsd: candidate.maxRepayUsd,
  });
}`,
  },
  {
    id: "subscribe",
    label: "Position monitoring",
    desc:
      "Subscribe to a borrower's Pledged / Repaid / Liquidated events without managing log filters yourself.",
    code: `const unsub = ef.events.onPosition({
  user: "0xA73…2cC1",
  events: ["Pledged", "Repaid", "Liquidated"],
}, (e) => {
  switch (e.kind) {
    case "Pledged":
      console.log("collat added", e.amount, e.token);
      break;
    case "Repaid":
      console.log("debt reduced", e.amount);
      break;
    case "Liquidated":
      alert(\`liquidated by \${e.liquidator} — \${e.debtRepaid}\`);
      break;
  }
});

// later
unsub();`,
  },
  {
    id: "aa",
    label: "Gas-sponsored userOp via AA",
    desc:
      "Manually compose a UserOperation, sign it, and submit. Bypass the bundled .pledge() helper when you need full control.",
    code: `import { encodeFunctionData } from "viem";
import { vaultAbi } from "@equiflow/sdk/abi";

const callData = encodeFunctionData({
  abi: vaultAbi,
  functionName: "pledgeAndBorrow",
  args: [tslaToken, parseUnits("12.5", 18), parseUnits("3200", 18)],
});

const userOp = await ef.aa.buildUserOp({
  account: smartAccount,
  to: ef.addresses.vault,
  callData,
  sponsor: "paymaster", // ask the gas manager to pay
});

const signed = await ef.aa.sign(userOp);
const { userOpHash } = await ef.aa.send(signed);

const receipt = await ef.aa.waitForReceipt(userOpHash, { timeout: 30_000 });
console.log(receipt.txHash);`,
  },
];

const MODULES = [
  {
    name: "vault",
    desc:
      "pledge, repay, withdraw, liquidate, simulate*. The most-used module.",
    fns: 9,
  },
  {
    name: "accounts",
    desc:
      "Smart-account creation, EIP-7702 delegation, counterfactual address resolution.",
    fns: 5,
  },
  {
    name: "pyth",
    desc:
      "Read normalized prices, refresh feeds, decode Pyth attestations off-chain.",
    fns: 6,
  },
  {
    name: "paymaster",
    desc:
      "Build, sponsor, and submit ERC-4337 user operations. Bundled into vault.* helpers.",
    fns: 4,
  },
  {
    name: "events",
    desc:
      "Typed subscriptions for Pledged, Repaid, Liquidated, InterestAccrued.",
    fns: 5,
  },
  {
    name: "utils",
    desc:
      "Health-factor math, USD ↔ token conversion, basis-point helpers, fmt.usd.",
    fns: 14,
  },
];

const TYPES: { name: string; signature: string; about: string }[] = [
  {
    name: "PledgeParams",
    signature: `type PledgeParams = {
  account: Account | LocalAccount;
  token: StockSymbol | Address;
  amount: bigint;          // collateral, base units
  borrowUsd: bigint;       // USDG, 1e18
  slippageBps?: number;    // default 50 (0.50%)
  paymaster?: \`0x\${string}\` | "paymaster" | false;
};`,
    about:
      "Argument shape for vault.pledge(). The same shape is reused for simulate*().",
  },
  {
    name: "Position",
    signature: `type Position = {
  user: Address;
  collateralUsd: bigint;
  borrowedUsd: bigint;
  hf: number;              // 1.000 = liquidation threshold
  ltvBps: number;
  isLiquidatable: boolean;
  pledges: Pledge[];
};`,
    about:
      "Snapshot returned by ef.positions.of(user) and embedded in every receipt.",
  },
  {
    name: "HealthFactor",
    signature: `type HealthFactor = {
  value: number;           // floating, derived from 1e18 raw
  raw: bigint;             // pass to contracts that take uint256
  band: "safe" | "watch" | "callable";
  collateralRoom: bigint;  // USDG you could still borrow
  dropToLiquidation: number; // % price drop before HF=1
};`,
    about: "Returned by ef.utils.healthFactor(position) and ef.vault.hfOf(user).",
  },
];

export default function SdkPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <PageNav
        rightExtras={
          <span
            className="font-mono inline-flex items-center gap-2"
            style={{
              padding: "5px 10px",
              fontSize: 11,
              letterSpacing: "0.04em",
              borderRadius: 2,
              border: "1px solid var(--hairline)",
              background: "var(--paper-alt)",
              color: "var(--ink-soft)",
            }}
          >
            <span
              className="inline-block"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--up)",
              }}
            />
            v0.4.2 · npm
          </span>
        }
      />

      <div
        className="border-b border-hairline-soft"
        style={{ padding: "12px 32px", background: "var(--amber-soft)" }}
      >
        <span style={{ fontSize: 12, letterSpacing: "0.06em" }} className="text-ink-soft font-mono uppercase">
          ILLUSTRATIVE · @equiflow/sdk is not yet published. Code examples are illustrative.
        </span>
      </div>

      <SdkHero />
      <QuickStart />
      <ExamplesSection />
      <ModulesReference />
      <TypesSection />
      <ComparisonStrip />
      <CtaStrip />

      <SiteFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function SdkHero() {
  return (
    <section className="border-b border-ink">
      <div className="max-w-[1320px] mx-auto px-8 pt-7 pb-7">
        <div className="grid" style={{ gridTemplateColumns: "1.3fr 1fr", gap: 36 }}>
          <div>
            <div className="eyebrow mb-2">
              Developers · TypeScript SDK · npm · MIT
            </div>
            <h1
              className="font-serif font-medium m-0"
              style={{
                fontSize: 38,
                letterSpacing: "-0.03em",
                lineHeight: 1.02,
              }}
            >
              EquiFlow SDK · <span className="italic">TypeScript</span>
            </h1>
            <p
              className="text-ink-soft mt-3 max-w-[560px]"
              style={{ fontSize: 14, lineHeight: 1.6 }}
            >
              Pledge equity, mint USDG, liquidate, and stream positions in
              under twenty lines. Built on viem, fully typed, zero hidden
              network calls. Drop-in for any Node, Bun, or browser runtime.
            </p>
            <div className="flex gap-2 mt-5 items-center flex-wrap">
              <CopyCode value={INSTALL_CMD} />
              <a
                href="#quick-start"
                className="font-mono no-underline text-ink"
                style={{
                  fontSize: 12,
                  padding: "8px 14px",
                  border: "1px solid var(--hairline)",
                  background: "var(--paper)",
                  borderRadius: 2,
                  letterSpacing: "0.04em",
                }}
              >
                Quick start ↓
              </a>
              <a
                href="https://github.com/equiflow-labs/sdk"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono no-underline text-ink"
                style={{
                  fontSize: 12,
                  padding: "8px 14px",
                  border: "1px solid var(--hairline)",
                  background: "var(--paper)",
                  borderRadius: 2,
                  letterSpacing: "0.04em",
                }}
              >
                GitHub ↗
              </a>
            </div>
            <div className="flex gap-5 mt-6 flex-wrap">
              {[
                ["Bundle size", "27 kB", "gzipped, ESM"],
                ["Test coverage", "94%", "vitest + foundry fork"],
                ["Weekly downloads", "11,402", "last 7 days"],
              ].map(([k, v, sub]) => (
                <div key={k}>
                  <div className="eyebrow mb-1">{k}</div>
                  <div
                    className="font-serif font-medium tabular"
                    style={{ fontSize: 22, letterSpacing: "-0.025em" }}
                  >
                    {v}
                  </div>
                  <div
                    className="font-mono text-ink-mute mt-0.5"
                    style={{ fontSize: 10 }}
                  >
                    {sub}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="eyebrow mb-2">Minimal viable script</div>
            <CodeBlock>{`// pledge.ts — 7 lines
import { ef } from "./client";

const r = await ef.vault.pledge({
  account: wallet,
  token: "TSLA",
  amount: 12_500000000000000000n,
  borrowUsd: 3_200000000000000000000n,
});
console.log(r.txHash, r.healthFactor.value);`}</CodeBlock>
            <div
              className="mt-3 font-mono text-ink-mute"
              style={{ fontSize: 10, letterSpacing: "0.06em" }}
            >
              {">>"} EXPECT · sealed in ~1.8s · 1 signature · 0 ETH gas
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function QuickStart() {
  return (
    <section
      id="quick-start"
      className="border-b border-hairline bg-paper-alt"
    >
      <div className="max-w-[1320px] mx-auto px-8 py-8">
        <div className="mb-5">
          <div className="eyebrow mb-1.5">Quick start · 4 steps · ~3 min</div>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: 26, letterSpacing: "-0.025em" }}
          >
            From <span className="italic">npm install</span> to first pledge.
          </h2>
        </div>

        <div
          className="grid grid-cols-2 bg-paper"
          style={{ border: "1px solid var(--hairline)" }}
        >
          {QUICKSTART.map((s, i) => (
            <div
              key={s.n}
              style={{
                padding: "22px 24px",
                borderRight:
                  i % 2 === 0 ? "1px solid var(--hairline)" : undefined,
                borderBottom:
                  i < QUICKSTART.length - 2
                    ? "1px solid var(--hairline)"
                    : undefined,
              }}
            >
              <div
                className="font-mono text-ink-mute flex items-center gap-2.5"
                style={{ fontSize: 11, letterSpacing: "0.16em" }}
              >
                {s.n}
                <span
                  style={{
                    flex: 1,
                    height: 1,
                    background: "var(--hairline)",
                  }}
                />
              </div>
              <h4
                className="font-serif font-medium"
                style={{
                  fontSize: 17,
                  letterSpacing: "-0.015em",
                  margin: "10px 0 6px",
                }}
              >
                {s.title}
              </h4>
              <p
                className="text-ink-soft m-0 mb-3"
                style={{ fontSize: 12.5, lineHeight: 1.5 }}
              >
                {s.blurb}
              </p>
              <CodeBlock small>{s.code}</CodeBlock>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function ExamplesSection() {
  const [tab, setTab] = useState(EXAMPLES[0].id);
  const current = EXAMPLES.find((e) => e.id === tab) ?? EXAMPLES[0];

  return (
    <section className="border-b border-hairline">
      <div className="max-w-[1320px] mx-auto px-8 py-8">
        <div className="flex justify-between items-baseline mb-4 flex-wrap gap-3">
          <div>
            <div className="eyebrow mb-1">
              Recipes · {EXAMPLES.length} copy-pasteable scripts
            </div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Examples worth <span className="italic">stealing</span>
            </h2>
          </div>
          <div className="flex gap-1 p-[3px] border border-hairline rounded-[2px]">
            {EXAMPLES.map((e) => (
              <button
                key={e.id}
                onClick={() => setTab(e.id)}
                className="border-0 px-3 py-1.5 rounded-[2px] transition-colors cursor-pointer"
                style={{
                  fontSize: 12,
                  background: tab === e.id ? "var(--ink)" : "transparent",
                  color: tab === e.id ? "var(--paper)" : "var(--ink-soft)",
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="grid"
          style={{ gridTemplateColumns: "1fr 1.4fr", gap: 24 }}
        >
          <div>
            <h3
              className="font-serif font-medium m-0"
              style={{ fontSize: 18, letterSpacing: "-0.02em" }}
            >
              {current.label}
            </h3>
            <p
              className="text-ink-soft mt-2"
              style={{ fontSize: 13, lineHeight: 1.6 }}
            >
              {current.desc}
            </p>
            <ul
              className="list-none p-0 m-0 mt-4 flex flex-col"
              style={{ gap: 8 }}
            >
              {EXAMPLES.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => setTab(e.id)}
                    className="cursor-pointer w-full text-left transition-colors"
                    style={{
                      padding: "10px 12px",
                      border: `1px solid ${tab === e.id ? "var(--ink)" : "var(--hairline)"}`,
                      background:
                        tab === e.id ? "var(--paper-alt)" : "transparent",
                      borderRadius: 2,
                    }}
                  >
                    <div
                      className="font-mono"
                      style={{ fontSize: 12, fontWeight: 500 }}
                    >
                      {e.label}
                    </div>
                    <div
                      className="font-mono text-ink-mute mt-1"
                      style={{ fontSize: 10.5, lineHeight: 1.5 }}
                    >
                      {e.desc.slice(0, 88)}…
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span
                className="font-mono text-ink-mute"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                {">>"} EXAMPLES / {current.id}.ts
              </span>
              <CopyCode value={current.code} compact />
            </div>
            <CodeBlock>{current.code}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function ModulesReference() {
  return (
    <section className="border-b border-hairline bg-paper-alt">
      <div className="max-w-[1320px] mx-auto px-8 py-8">
        <div className="flex justify-between items-baseline mb-3.5">
          <div>
            <div className="eyebrow mb-1">
              Module reference · {MODULES.length} surfaces
            </div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              What lives where
            </h2>
          </div>
          <Link
            href="/api-reference"
            className="font-mono no-underline text-ink-soft"
            style={{
              fontSize: 11,
              padding: "5px 11px",
              border: "1px solid var(--hairline)",
              background: "var(--paper)",
              borderRadius: 2,
              letterSpacing: "0.04em",
            }}
          >
            REST equivalent ↗
          </Link>
        </div>

        <div style={{ border: "1px solid var(--ink)", background: "var(--paper)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--ink)",
                  background: "var(--paper-alt)",
                }}
              >
                <Th>Module</Th>
                <Th>Import path</Th>
                <Th>Purpose</Th>
                <Th align="right">Exports</Th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m, i) => (
                <tr
                  key={m.name}
                  style={{
                    borderBottom:
                      i < MODULES.length - 1
                        ? "1px dashed var(--hairline-soft)"
                        : undefined,
                  }}
                >
                  <td style={{ padding: "13px 14px" }}>
                    <span
                      className="font-mono font-medium"
                      style={{ fontSize: 13 }}
                    >
                      ef.{m.name}
                    </span>
                  </td>
                  <td style={{ padding: "13px 14px" }}>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 11.5,
                        background: "var(--paper-alt)",
                        padding: "2px 6px",
                      }}
                    >
                      @equiflow/sdk/{m.name}
                    </span>
                  </td>
                  <td
                    className="text-ink-soft"
                    style={{
                      padding: "13px 14px",
                      fontSize: 12.5,
                      lineHeight: 1.5,
                    }}
                  >
                    {m.desc}
                  </td>
                  <td
                    style={{
                      padding: "13px 14px",
                      textAlign: "right",
                    }}
                  >
                    <span
                      className="font-mono tabular"
                      style={{ fontSize: 12 }}
                    >
                      {m.fns} fn{m.fns === 1 ? "" : "s"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function TypesSection() {
  return (
    <section className="border-b border-hairline">
      <div className="max-w-[1320px] mx-auto px-8 py-8">
        <div className="mb-4">
          <div className="eyebrow mb-1">
            Core types · re-exported from @equiflow/sdk/types
          </div>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: 22, letterSpacing: "-0.025em" }}
          >
            Type signatures you'll <span className="italic">actually</span> reach for
          </h2>
        </div>
        <div className="grid grid-cols-3" style={{ gap: 18 }}>
          {TYPES.map((t) => (
            <div
              key={t.name}
              style={{
                border: "1px solid var(--hairline)",
                background: "var(--paper)",
              }}
            >
              <div
                className="font-mono"
                style={{
                  padding: "10px 14px",
                  fontSize: 12,
                  background: "var(--paper-alt)",
                  borderBottom: "1px solid var(--hairline)",
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                }}
              >
                type · {t.name}
              </div>
              <div style={{ padding: "0" }}>
                <CodeBlock small flat>{t.signature}</CodeBlock>
              </div>
              <p
                className="text-ink-soft m-0"
                style={{
                  padding: "10px 14px",
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  borderTop: "1px dashed var(--hairline-soft)",
                }}
              >
                {t.about}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function ComparisonStrip() {
  const rows: { label: string; sdk: string; wagmi: string; api: string }[] = [
    {
      label: "Pledge + borrow",
      sdk: "1 call · ef.vault.pledge()",
      wagmi: "4 calls · approve → wait → contract write → wait",
      api: "1 POST · /v1/aa/userop",
    },
    {
      label: "Gas sponsorship",
      sdk: "built-in · paymaster opt-in",
      wagmi: "DIY · build, sign, submit userOp",
      api: "automatic when key has sponsor scope",
    },
    {
      label: "Type safety",
      sdk: "full · custom errors typed",
      wagmi: "ABI-derived · errors are strings",
      api: "OpenAPI 3.1 · client gen",
    },
    {
      label: "Health-factor math",
      sdk: "ef.utils.healthFactor()",
      wagmi: "manual · read collateralUsd + borrowedUsd",
      api: "GET /v1/positions/:addr",
    },
    {
      label: "Liquidation stream",
      sdk: "for await · ef.liquidations.watch()",
      wagmi: "log filters · manual reconciliation",
      api: "webhook position.liquidated",
    },
    {
      label: "Bundle size",
      sdk: "27 kB gz",
      wagmi: "+viem +abitype = 84 kB gz",
      api: "0 — server-side",
    },
  ];
  return (
    <section className="border-b border-hairline bg-paper-alt">
      <div className="max-w-[1320px] mx-auto px-8 py-8">
        <div className="mb-4">
          <div className="eyebrow mb-1">Comparison · pick your altitude</div>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: 22, letterSpacing: "-0.025em" }}
          >
            SDK vs raw wagmi vs REST API
          </h2>
        </div>
        <div
          style={{
            border: "1px solid var(--ink)",
            background: "var(--paper)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--ink)",
                  background: "var(--paper-alt)",
                }}
              >
                <Th> </Th>
                <Th>
                  <span style={{ color: "var(--ink)" }}>@equiflow/sdk</span>
                </Th>
                <Th>Raw wagmi + viem</Th>
                <Th>REST API</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.label}
                  style={{
                    borderBottom:
                      i < rows.length - 1
                        ? "1px dashed var(--hairline-soft)"
                        : undefined,
                  }}
                >
                  <td
                    style={{
                      padding: "12px 14px",
                      fontSize: 12.5,
                      fontWeight: 500,
                    }}
                  >
                    {r.label}
                  </td>
                  <td
                    style={{
                      padding: "12px 14px",
                      background: "var(--up-soft)",
                    }}
                  >
                    <span
                      className="font-mono"
                      style={{ fontSize: 11.5, color: "var(--ink)" }}
                    >
                      {r.sdk}
                    </span>
                  </td>
                  <td
                    className="text-ink-soft"
                    style={{ padding: "12px 14px", fontSize: 11.5 }}
                  >
                    <span className="font-mono">{r.wagmi}</span>
                  </td>
                  <td
                    className="text-ink-soft"
                    style={{ padding: "12px 14px", fontSize: 11.5 }}
                  >
                    <span className="font-mono">{r.api}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function CtaStrip() {
  return (
    <section className="border-t border-ink bg-paper-alt">
      <div className="max-w-[1320px] mx-auto px-8 py-8">
        <div
          className="flex items-center justify-between gap-4 flex-wrap"
          style={{
            padding: "20px 22px",
            background: "var(--ink)",
            color: "var(--paper)",
            borderRadius: 2,
          }}
        >
          <div className="flex items-center gap-4 max-w-[680px]">
            <span
              className="font-mono"
              style={{
                fontSize: 10,
                opacity: 0.6,
                letterSpacing: "0.14em",
              }}
            >
              SHIPPING TODAY?
            </span>
            <span style={{ fontSize: 14, lineHeight: 1.5 }}>
              Three command lines and you're calling the vault.{" "}
              <span style={{ opacity: 0.7 }}>
                The SDK ships TypeScript declarations and a Foundry-tested fork
                runner so your tests don't touch mainnet.
              </span>
            </span>
          </div>
          <div className="flex gap-2">
            <Link
              href="/contracts"
              className="font-medium no-underline text-paper"
              style={{
                padding: "9px 16px",
                fontSize: 12,
                background: "transparent",
                border: "1px solid rgba(250, 248, 242, 0.3)",
                borderRadius: 2,
              }}
            >
              Browse contracts
            </Link>
            <a
              href="https://github.com/equiflow-labs/sdk"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium no-underline text-ink"
              style={{
                padding: "9px 16px",
                fontSize: 12,
                background: "var(--paper)",
                border: "none",
                borderRadius: 2,
              }}
            >
              View source ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function CodeBlock({
  children,
  small,
  flat,
}: {
  children: string;
  small?: boolean;
  flat?: boolean;
}) {
  return (
    <pre
      className="font-mono m-0"
      style={{
        background: "var(--ink)",
        color: "var(--paper)",
        padding: small ? "12px 14px" : "14px 16px",
        borderRadius: flat ? 0 : 2,
        fontSize: small ? 11.5 : 12,
        lineHeight: 1.6,
        overflow: "auto",
        whiteSpace: "pre",
      }}
    >
      {children}
    </pre>
  );
}

function CopyCode({ value, compact }: { value: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="font-mono inline-flex items-center gap-2 cursor-pointer transition-colors"
      style={{
        fontSize: compact ? 10 : 12,
        padding: compact ? "4px 9px" : "8px 14px",
        background: copied ? "var(--up-soft)" : "var(--paper)",
        color: copied ? "var(--up)" : "var(--ink)",
        border: `1px solid ${copied ? "var(--up)" : "var(--hairline)"}`,
        borderRadius: 2,
        letterSpacing: "0.04em",
      }}
    >
      {compact ? (
        copied ? "copied" : "copy"
      ) : (
        <>
          <span style={{ opacity: 0.4 }}>$</span>
          {value}
          <span style={{ opacity: 0.5, marginLeft: 4 }}>
            {copied ? "✓ copied" : "⧉"}
          </span>
        </>
      )}
    </button>
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
