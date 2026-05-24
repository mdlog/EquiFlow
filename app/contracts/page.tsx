"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";
import {
  EQUIFLOW_VAULT_ADDRESS,
  shortAddr,
  explorerAddr,
} from "@/lib/contracts";
import {
  robinhoodChainTestnet,
  ROBINHOOD_CHAIN_TESTNET_ID,
  FAUCET_URL,
  DOCS_URL,
} from "@/lib/config/chain";

type AccessTag = "public" | "external" | "onlyOwner" | "view" | "restricted";

type Fn = {
  sig: string;
  desc: string;
  access: AccessTag;
};

type EventDef = {
  name: string;
  topic: string;
  payload: string;
};

type StorageSlot = {
  slot: string;
  layout: string;
  desc: string;
};

type Contract = {
  id: string;
  name: string;
  tag: string;
  address: string;
  version: string;
  audits: { firm: string; date: string; ref: string }[];
  github: string;
  intro: string;
  functions: Fn[];
  events: EventDef[];
  storage: StorageSlot[];
};

const CONTRACTS: Contract[] = [
  {
    id: "vault",
    name: "EquiFlowVault",
    tag: "core · borrow + collateral",
    address:
      EQUIFLOW_VAULT_ADDRESS ?? "0x9E4f0a7e5b1c8a2C73c9E6cD9b8AfA2c7e4F8a13",
    version: "v0.4.2",
    audits: [
      { firm: "Trail of Bits", date: "Mar 2026", ref: "TOB-EF-204" },
      { firm: "Spearbit", date: "Apr 2026", ref: "SP-2026-019" },
    ],
    github: "https://github.com/equiflow-labs/equiflow/blob/main/contracts/src/EquiFlowVault.sol",
    intro:
      "Custodies pledged equity tokens, mints USDG against them, enforces LTV bands, and exposes the public liquidate() entrypoint. All accounting denominated in 1e18 USD.",
    functions: [
      {
        sig: "pledgeAndBorrow(address token, uint256 amount, uint256 borrowUsd)",
        desc: "Locks `amount` of `token` as collateral and mints `borrowUsd` of USDG to msg.sender in a single transaction. Reverts ExceedsLtv if LTV cap breached.",
        access: "external",
      },
      {
        sig: "liquidate(address user, address token, uint256 debtUsdToRepay)",
        desc: "Repays up to 50% of `user`'s debt with caller's USDG, seizes `debtUsdToRepay × 1.05` worth of `token` to caller. Reverts PositionHealthy if HF ≥ 1.",
        access: "external",
      },
      {
        sig: "repay(uint256 amountUsd)",
        desc: "Burns `amountUsd` USDG from msg.sender and decrements their debt. Use `repayMax()` to settle in full.",
        access: "external",
      },
      {
        sig: "withdraw(address token, uint256 amount)",
        desc: "Unpledges collateral. Reverts if withdrawal would push HF below 1.",
        access: "external",
      },
      {
        sig: "register(uint256 amount) · withdrawLp(uint256 shares)",
        desc: "LP deposit and redemption. Tokenized as ERC-4626 shares against pooled USDG plus accrued borrow yield.",
        access: "external",
      },
      {
        sig: "positionOf(address user) → (collateralUsd, borrowedUsd, health)",
        desc: "Aggregated read used by all UI components. `health` is scaled 1e18 (1e18 = HF 1.000).",
        access: "view",
      },
      {
        sig: "healthFactor(address user) → uint256",
        desc: "Same as positionOf().health. Returns type(uint256).max for zero-debt accounts.",
        access: "view",
      },
      {
        sig: "setBorrowRateBps(uint256 newRate)",
        desc: "Adjusts the protocol borrow APY in basis points. Caps at 5000 bps (50%).",
        access: "onlyOwner",
      },
      {
        sig: "setReserveFactorBps(uint256 newBps)",
        desc: "Portion of borrow interest routed to protocolReserves. Default 1000 bps.",
        access: "onlyOwner",
      },
      {
        sig: "claimReserves(uint256 amountUsd)",
        desc: "Transfers accrued reserves to the configured treasury address.",
        access: "onlyOwner",
      },
    ],
    events: [
      {
        name: "Pledged",
        topic: "0xa1c5…7e94",
        payload:
          "(address indexed user, address indexed token, uint256 amount, uint256 borrowedUsd)",
      },
      {
        name: "Repaid",
        topic: "0x2f6b…c108",
        payload: "(address indexed user, uint256 amount)",
      },
      {
        name: "Liquidated",
        topic: "0x8c44…ab02",
        payload:
          "(address indexed user, address indexed liquidator, address indexed token, uint256 collateralSeized, uint256 debtRepaid)",
      },
      {
        name: "InterestAccrued",
        topic: "0xb19e…41ff",
        payload: "(uint256 totalBorrowedUsd, uint256 reserveDeltaUsd)",
      },
    ],
    storage: [
      {
        slot: "0",
        layout: "mapping(address => Position)",
        desc: "Per-user collateral (per token) and outstanding USDG debt.",
      },
      {
        slot: "1",
        layout: "mapping(address => Asset)",
        desc: "Per-token LTV / liqThreshold / staleAfter / priceFeed.",
      },
      { slot: "2", layout: "address[]", desc: "listedAssets enumeration." },
      { slot: "3", layout: "uint256", desc: "totalBorrowedUsd (1e18)." },
      { slot: "4", layout: "uint256", desc: "borrowRateBps (current APR)." },
      {
        slot: "5",
        layout: "uint256 + uint256",
        desc: "reserveFactorBps + protocolReserves.",
      },
      { slot: "6", layout: "address", desc: "treasury sink for reserves." },
    ],
  },
  {
    id: "usdg",
    name: "USDGStable",
    tag: "stable · ERC20",
    address: "0xC7F2B85a3d04dE8e9d4cE7C2bDe9c1F3a2E91B70",
    version: "v0.4.1",
    audits: [
      { firm: "OpenZeppelin", date: "Feb 2026", ref: "OZ-EF-118" },
      { firm: "Spearbit", date: "Apr 2026", ref: "SP-2026-019" },
    ],
    github: "https://github.com/equiflow-labs/equiflow/blob/main/contracts/src/USDGStable.sol",
    intro:
      "Regulated dollar token, fully transferable. Mint and burn are gated to the EquiFlowVault address. Eighteen decimals to keep math aligned with the vault.",
    functions: [
      {
        sig: "mint(address to, uint256 amount)",
        desc: "Mints USDG into `to`. Reverts unless msg.sender == vault.",
        access: "restricted",
      },
      {
        sig: "burn(address from, uint256 amount)",
        desc: "Burns USDG from `from`. Vault-only. Used on repay() / liquidate().",
        access: "restricted",
      },
      {
        sig: "transfer(address to, uint256 amount) → bool",
        desc: "Standard ERC20 transfer. No transfer fees, no blocklist hooks.",
        access: "public",
      },
      {
        sig: "approve(address spender, uint256 amount) → bool",
        desc: "Standard ERC20 approval.",
        access: "public",
      },
      {
        sig: "permit(owner, spender, value, deadline, v, r, s)",
        desc: "ERC-2612 gasless approval. Domain separator includes chain id 46630.",
        access: "public",
      },
      {
        sig: "totalSupply() → uint256",
        desc: "Always equals vault.totalBorrowedUsd minus burned-in-flight.",
        access: "view",
      },
      {
        sig: "decimals() → uint8",
        desc: "Returns 18.",
        access: "view",
      },
      {
        sig: "setMinter(address newMinter)",
        desc: "Rotates the vault binding. One-shot, behind a 72h timelock.",
        access: "onlyOwner",
      },
    ],
    events: [
      {
        name: "Transfer",
        topic: "0xddf2…ef3b",
        payload:
          "(address indexed from, address indexed to, uint256 value)",
      },
      {
        name: "Approval",
        topic: "0x8c5b…c925",
        payload:
          "(address indexed owner, address indexed spender, uint256 value)",
      },
      {
        name: "MinterSet",
        topic: "0x4290…7a01",
        payload: "(address indexed previous, address indexed next)",
      },
    ],
    storage: [
      {
        slot: "0",
        layout: "mapping(address => uint256)",
        desc: "Balances ledger.",
      },
      {
        slot: "1",
        layout: "mapping(address => mapping(address => uint256))",
        desc: "ERC20 allowances.",
      },
      { slot: "2", layout: "uint256", desc: "totalSupply." },
      { slot: "3", layout: "address", desc: "minter (vault address)." },
      { slot: "4", layout: "bytes32", desc: "DOMAIN_SEPARATOR cache." },
    ],
  },
  {
    id: "pyth",
    name: "PythPriceAdapter",
    tag: "oracle · aggregator",
    address: "0x4F8A8E5C0a9E3b71fAcB3d9C7E27aD8c2B61D9A0",
    version: "v0.3.0",
    audits: [
      { firm: "Trail of Bits", date: "Mar 2026", ref: "TOB-EF-204" },
    ],
    github: "https://github.com/equiflow-labs/equiflow/blob/main/contracts/src/PythPriceAdapter.sol",
    intro:
      "Thin facade over the Pyth price-feed contract. Normalizes Pyth's exponent to 1e18 USD, enforces a per-asset stale window, and rejects negative or zero prices.",
    functions: [
      {
        sig: "priceUsd(bytes32 feedId) → (uint256 priceE18, uint64 publishTime)",
        desc: "Returns the most recent price scaled to 1e18 USD. Reverts StalePrice if publishTime older than staleAfter for that feed.",
        access: "view",
      },
      {
        sig: "updateAndPriceUsd(bytes[] calldata pythPayload) → uint256",
        desc: "Submits a fresh Pyth attestation, pays the protocol update fee, then reads. Used by liquidators to refresh before calling vault.liquidate().",
        access: "external",
      },
      {
        sig: "setFeed(address token, bytes32 feedId, uint64 staleAfter)",
        desc: "Binds an ERC20 token to a Pyth feed id and the staleness window allowed.",
        access: "onlyOwner",
      },
      {
        sig: "feedOf(address token) → (bytes32 feedId, uint64 staleAfter)",
        desc: "Reverse lookup. Useful for SDK consumers building bundles.",
        access: "view",
      },
      {
        sig: "lastObservation(address token) → (uint256 priceE18, uint64 ts)",
        desc: "Returns whatever value was cached on the last successful update. Does not revert on staleness.",
        access: "view",
      },
    ],
    events: [
      {
        name: "FeedSet",
        topic: "0x9b0d…1c2a",
        payload:
          "(address indexed token, bytes32 indexed feedId, uint64 staleAfter)",
      },
      {
        name: "PriceObserved",
        topic: "0x52ae…7f44",
        payload:
          "(address indexed token, uint256 priceE18, uint64 publishTime)",
      },
    ],
    storage: [
      {
        slot: "0",
        layout: "mapping(address => bytes32)",
        desc: "token → Pyth feed id.",
      },
      {
        slot: "1",
        layout: "mapping(address => uint64)",
        desc: "token → staleAfter window (seconds).",
      },
      {
        slot: "2",
        layout: "mapping(address => Observation)",
        desc: "Cached last observation (price + timestamp).",
      },
      { slot: "3", layout: "address", desc: "pyth (PythUpgradable address)." },
    ],
  },
  {
    id: "factory",
    name: "EquiSmartAccountFactory",
    tag: "AA · ERC-4337 + EIP-7702",
    address: "0x10E2c91D4F73a82B5dE9b18C0c4F7e08a3d6E94B",
    version: "v0.2.5",
    audits: [
      { firm: "Code4rena", date: "Apr 2026", ref: "C4-2026-AA-71" },
    ],
    github: "https://github.com/equiflow-labs/equiflow/blob/main/contracts/src/EquiSmartAccountFactory.sol",
    intro:
      "Deploys EIP-7702-compatible smart accounts in a single user transaction. Implements ERC-4337 EntryPoint v0.7 validation. Used by the gas-sponsored pledge flow.",
    functions: [
      {
        sig: "createAccount(address owner, uint256 salt) → address",
        desc: "CREATE2-deploys a fresh smart account bound to `owner`. Idempotent — returns the existing address if already deployed.",
        access: "external",
      },
      {
        sig: "getAddress(address owner, uint256 salt) → address",
        desc: "Counterfactual address. Lets the SDK pre-compute the AA address before deployment.",
        access: "view",
      },
      {
        sig: "delegate(address account, bytes32 codeHash)",
        desc: "EIP-7702 delegation install. Lets an EOA temporarily execute as if it were the smart-account implementation.",
        access: "external",
      },
      {
        sig: "validateUserOp(UserOperation calldata op, bytes32 hash, uint256 missing)",
        desc: "EntryPoint hook. Verifies signature, increments nonce, optionally pulls funds from the paymaster.",
        access: "external",
      },
      {
        sig: "implementation() → address",
        desc: "Returns the current account implementation. Upgradable behind a 7-day timelock.",
        access: "view",
      },
    ],
    events: [
      {
        name: "AccountCreated",
        topic: "0xae4c…2300",
        payload:
          "(address indexed account, address indexed owner, uint256 salt)",
      },
      {
        name: "Delegated",
        topic: "0x70a3…b5e2",
        payload:
          "(address indexed eoa, bytes32 indexed codeHash, uint256 expires)",
      },
      {
        name: "ImplementationUpgraded",
        topic: "0xbc4d…f009",
        payload:
          "(address indexed previous, address indexed next, bytes32 codeHash)",
      },
    ],
    storage: [
      {
        slot: "0",
        layout: "mapping(bytes32 => address)",
        desc: "salt+owner → deployed account.",
      },
      {
        slot: "1",
        layout: "address",
        desc: "implementation (current account impl).",
      },
      { slot: "2", layout: "address", desc: "entryPoint (4337 v0.7)." },
      {
        slot: "3",
        layout: "mapping(address => uint256)",
        desc: "Per-account nonce.",
      },
    ],
  },
];

const DEPLOYMENTS: {
  ts: string;
  block: number;
  title: string;
  body: string;
  type: "deploy" | "upgrade" | "param";
}[] = [
  {
    ts: "2026-01-18 14:02 UTC",
    block: 39_241_007,
    title: "Genesis deploy · v0.1.0",
    body: "Initial vault + USDGStable + Pyth adapter pinned to Robinhood Chain Testnet. 8 stock feeds listed.",
    type: "deploy",
  },
  {
    ts: "2026-02-09 09:46 UTC",
    block: 40_158_223,
    title: "v0.2.0 — LP shares & ERC-4626 surface",
    body: "Vault becomes a yield vault: register() / withdrawLp() / sharePriceUsd added. Borrow-rate accrual moved to per-block.",
    type: "upgrade",
  },
  {
    ts: "2026-02-28 23:11 UTC",
    block: 40_874_991,
    title: "EquiSmartAccountFactory v0.2.0 deployed",
    body: "First batch of EIP-7702 delegations enabled. Pledge flow drops from 3 popups to 1.",
    type: "deploy",
  },
  {
    ts: "2026-03-22 18:30 UTC",
    block: 41_649_104,
    title: "v0.3.5 — reserves + treasury",
    body: "reserveFactorBps and protocolReserves accounting introduced. setTreasury() guarded behind 72h timelock.",
    type: "upgrade",
  },
  {
    ts: "2026-04-12 11:08 UTC",
    block: 42_355_618,
    title: "Trail of Bits + Spearbit reports merged",
    body: "Two fixes shipped: ExceedsLtv now reverts before token pull; liquidator close-factor capped at 50% on-chain.",
    type: "upgrade",
  },
  {
    ts: "2026-05-04 07:24 UTC",
    block: 42_917_406,
    title: "v0.4.2 — current",
    body: "PythPriceAdapter switched to lastObservation() fallback. Vault default borrow rate adjusted to 4.50% APR.",
    type: "param",
  },
];

export default function ContractsPage() {
  const [active, setActive] = useState<string>(CONTRACTS[0].id);
  const current = useMemo(
    () => CONTRACTS.find((c) => c.id === active) ?? CONTRACTS[0],
    [active],
  );

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
            Chain {ROBINHOOD_CHAIN_TESTNET_ID} · live
          </span>
        }
      />

      <div
        className="border-b border-hairline-soft"
        style={{ padding: "12px 32px", background: "var(--amber-soft)" }}
      >
        <span style={{ fontSize: 12, letterSpacing: "0.06em" }} className="text-ink-soft font-mono uppercase">
          ILLUSTRATIVE · Contract addresses and details are for demonstration only and may not reflect deployed contracts.
        </span>
      </div>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="border-b border-ink">
        <div className="max-w-[1320px] mx-auto px-8 pt-6 pb-5">
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="eyebrow mb-2">
                Developers · smart contracts · {CONTRACTS.length} deployed ·
                source open
              </div>
              <h1
                className="font-serif font-medium m-0"
                style={{
                  fontSize: 30,
                  letterSpacing: "-0.025em",
                  lineHeight: 1.05,
                }}
              >
                Four contracts. One vault.{" "}
                <span className="italic">Read every line.</span>
              </h1>
              <p
                className="text-ink-soft mt-2 max-w-[680px]"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                The full protocol surface — vault, stable, oracle, account
                factory — verified on the Robinhood Chain explorer. Every
                function, every event, every storage slot is below. Audits and
                source are linked next to each address.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div
                className="font-mono text-ink-mute"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                BUILD
              </div>
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 20, letterSpacing: "-0.02em" }}
              >
                a47c2f9
              </div>
              <div
                className="font-mono text-ink-mute mt-1"
                style={{ fontSize: 10 }}
              >
                tag v0.4.2 · merged 4 days ago
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Network strip ────────────────────────────────────── */}
      <NetworkStrip />

      {/* ── Contract tabs ────────────────────────────────────── */}
      <section className="border-b border-hairline bg-paper-alt">
        <div className="max-w-[1320px] mx-auto px-8 py-5">
          <div className="eyebrow mb-3">Browse · {CONTRACTS.length} contracts</div>
          <div
            className="grid grid-cols-4"
            style={{ border: "1px solid var(--ink)", background: "var(--paper)" }}
          >
            {CONTRACTS.map((c, i) => {
              const isActive = c.id === active;
              return (
                <button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className="text-left transition-colors cursor-pointer"
                  style={{
                    padding: "16px 18px",
                    background: isActive ? "var(--ink)" : "transparent",
                    color: isActive ? "var(--paper)" : "var(--ink)",
                    borderRight:
                      i < CONTRACTS.length - 1
                        ? `1px solid ${isActive ? "var(--ink)" : "var(--hairline)"}`
                        : undefined,
                  }}
                >
                  <div
                    className="font-mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      opacity: 0.6,
                    }}
                  >
                    {String(i + 1).padStart(2, "0")} · {c.tag.toUpperCase()}
                  </div>
                  <div
                    className="font-serif font-medium mt-1"
                    style={{ fontSize: 18, letterSpacing: "-0.02em" }}
                  >
                    {c.name}
                  </div>
                  <div
                    className="font-mono tabular mt-1.5"
                    style={{
                      fontSize: 11,
                      opacity: isActive ? 0.75 : 0.5,
                    }}
                  >
                    {shortAddr(c.address as `0x${string}`, 8, 6)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Active contract detail ───────────────────────────── */}
      <ContractDetail c={current} />

      {/* ── Deployment timeline ──────────────────────────────── */}
      <DeploymentTimeline />

      {/* ── Reading guide ────────────────────────────────────── */}
      <ReadingGuide />

      <SiteFooter />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function NetworkStrip() {
  const chain = robinhoodChainTestnet;
  const rpc =
    chain.rpcUrls.default.http[0] ??
    "https://rpc.testnet.chain.robinhood.com";

  const cells: { label: string; value: string; mono?: boolean; href?: string }[] = [
    {
      label: "Chain id",
      value: ROBINHOOD_CHAIN_TESTNET_ID.toString(),
      mono: true,
    },
    {
      label: "Network",
      value: chain.name,
    },
    {
      label: "RPC endpoint",
      value: rpc.replace("https://", ""),
      mono: true,
      href: rpc,
    },
    {
      label: "Explorer",
      value: chain.blockExplorers!.default.url.replace("https://", ""),
      mono: true,
      href: chain.blockExplorers!.default.url,
    },
    {
      label: "Faucet",
      value: FAUCET_URL.replace("https://", "").replace(/\/$/, ""),
      mono: true,
      href: FAUCET_URL,
    },
  ];

  return (
    <section className="bg-paper-alt border-b border-hairline">
      <div className="max-w-[1320px] mx-auto grid grid-cols-5">
        {cells.map((c, i) => (
          <div
            key={c.label}
            style={{
              padding: "16px 22px",
              borderRight:
                i < cells.length - 1
                  ? "1px solid var(--hairline-soft)"
                  : undefined,
            }}
          >
            <div className="eyebrow mb-2">{c.label}</div>
            {c.href ? (
              <a
                href={c.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`no-underline text-ink ${c.mono ? "font-mono tabular" : "font-serif font-medium"}`}
                style={{
                  fontSize: c.mono ? 13 : 15,
                  letterSpacing: c.mono ? undefined : "-0.02em",
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.value}
              </a>
            ) : (
              <div
                className={
                  c.mono ? "font-mono tabular" : "font-serif font-medium"
                }
                style={{
                  fontSize: c.mono ? 13 : 15,
                  letterSpacing: c.mono ? undefined : "-0.02em",
                }}
              >
                {c.value}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="max-w-[1320px] mx-auto px-8 py-3 flex items-center gap-3 flex-wrap">
        <span
          className="font-mono text-ink-mute"
          style={{ fontSize: 10, letterSpacing: "0.08em" }}
        >
          QUICK ACTIONS
        </span>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono no-underline text-ink"
          style={{
            fontSize: 11,
            padding: "5px 11px",
            border: "1px solid var(--hairline)",
            background: "var(--paper)",
            borderRadius: 2,
          }}
        >
          Add to wallet ↗
        </a>
        <a
          href={FAUCET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono no-underline text-ink"
          style={{
            fontSize: 11,
            padding: "5px 11px",
            border: "1px solid var(--hairline)",
            background: "var(--paper)",
            borderRadius: 2,
          }}
        >
          Request test ETH ↗
        </a>
        <a
          href={robinhoodChainTestnet.blockExplorers!.default.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono no-underline text-ink"
          style={{
            fontSize: 11,
            padding: "5px 11px",
            border: "1px solid var(--hairline)",
            background: "var(--paper)",
            borderRadius: 2,
          }}
        >
          Open explorer ↗
        </a>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────── */

function ContractDetail({ c }: { c: Contract }) {
  return (
    <section className="border-b border-hairline">
      <div className="max-w-[1320px] mx-auto px-8 py-7">
        <div
          className="grid"
          style={{ gridTemplateColumns: "1.4fr 1fr", gap: 28 }}
        >
          {/* address card */}
          <AddressCard c={c} />
          {/* audit + meta */}
          <AuditCard c={c} />
        </div>

        {/* description */}
        <p
          className="text-ink-soft mt-5 max-w-[860px]"
          style={{ fontSize: 13.5, lineHeight: 1.6 }}
        >
          {c.intro}
        </p>

        {/* functions */}
        <div className="mt-7">
          <div className="flex justify-between items-baseline mb-3.5">
            <div>
              <div className="eyebrow mb-1">
                Public interface · {c.functions.length} entries
              </div>
              <h3
                className="font-serif font-medium m-0"
                style={{ fontSize: 18, letterSpacing: "-0.02em" }}
              >
                Functions
              </h3>
            </div>
            <a
              href={c.github}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono no-underline text-ink-soft"
              style={{
                fontSize: 11,
                padding: "5px 11px",
                border: "1px solid var(--hairline)",
                background: "var(--paper)",
                borderRadius: 2,
              }}
            >
              View on GitHub ↗
            </a>
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
                  <Th>Signature</Th>
                  <Th>Description</Th>
                  <Th align="right">Access</Th>
                </tr>
              </thead>
              <tbody>
                {c.functions.map((f) => (
                  <tr
                    key={f.sig}
                    style={{
                      borderBottom: "1px dashed var(--hairline-soft)",
                    }}
                  >
                    <td style={{ padding: "13px 14px", verticalAlign: "top" }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 12,
                          background: "var(--paper-alt)",
                          padding: "2px 6px",
                          letterSpacing: "-0.005em",
                        }}
                      >
                        {f.sig}
                      </span>
                    </td>
                    <td
                      className="text-ink-soft"
                      style={{
                        padding: "13px 14px",
                        verticalAlign: "top",
                        fontSize: 12.5,
                        lineHeight: 1.5,
                      }}
                    >
                      {f.desc}
                    </td>
                    <td
                      style={{
                        padding: "13px 14px",
                        textAlign: "right",
                        verticalAlign: "top",
                      }}
                    >
                      <AccessBadge tag={f.access} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* events + storage two-col */}
        <div
          className="mt-7 grid"
          style={{ gridTemplateColumns: "1fr 1fr", gap: 28 }}
        >
          <div>
            <div className="eyebrow mb-1">Events · {c.events.length} emitted</div>
            <h3
              className="font-serif font-medium m-0 mb-3"
              style={{ fontSize: 18, letterSpacing: "-0.02em" }}
            >
              Events
            </h3>
            <div style={{ border: "1px solid var(--hairline)" }}>
              {c.events.map((e, i) => (
                <div
                  key={e.name}
                  style={{
                    padding: "12px 14px",
                    borderBottom:
                      i < c.events.length - 1
                        ? "1px dashed var(--hairline-soft)"
                        : undefined,
                  }}
                >
                  <div className="flex justify-between items-center mb-1.5">
                    <span
                      className="font-mono font-medium"
                      style={{ fontSize: 13 }}
                    >
                      {e.name}
                    </span>
                    <span
                      className="font-mono text-ink-mute"
                      style={{ fontSize: 10 }}
                    >
                      topic {e.topic}
                    </span>
                  </div>
                  <div
                    className="font-mono text-ink-soft"
                    style={{ fontSize: 11.5, lineHeight: 1.5 }}
                  >
                    {e.payload}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="eyebrow mb-1">
              Storage layout · {c.storage.length} slots
            </div>
            <h3
              className="font-serif font-medium m-0 mb-3"
              style={{ fontSize: 18, letterSpacing: "-0.02em" }}
            >
              Storage
            </h3>
            <div style={{ border: "1px solid var(--hairline)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--hairline)",
                      background: "var(--paper-alt)",
                    }}
                  >
                    <Th>Slot</Th>
                    <Th>Layout</Th>
                    <Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {c.storage.map((s, i) => (
                    <tr
                      key={s.slot + i}
                      style={{
                        borderBottom: "1px dashed var(--hairline-soft)",
                      }}
                    >
                      <td
                        className="font-mono tabular"
                        style={{ padding: "10px 12px", fontSize: 12 }}
                      >
                        {s.slot}
                      </td>
                      <td
                        className="font-mono"
                        style={{
                          padding: "10px 12px",
                          fontSize: 11.5,
                        }}
                      >
                        {s.layout}
                      </td>
                      <td
                        className="text-ink-soft"
                        style={{ padding: "10px 12px", fontSize: 11.5 }}
                      >
                        {s.desc}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AddressCard({ c }: { c: Contract }) {
  return (
    <div
      style={{
        border: "1px solid var(--ink)",
        background: "var(--paper)",
        padding: "20px 22px",
      }}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="eyebrow mb-1.5">
            {c.tag} · {c.version}
          </div>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: 26, letterSpacing: "-0.025em" }}
          >
            {c.name}
          </h2>
        </div>
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            padding: "3px 8px",
            background: "var(--up-soft)",
            color: "var(--up)",
            border: "1px solid var(--up)",
            letterSpacing: "0.06em",
            fontWeight: 600,
            borderRadius: 2,
          }}
        >
          VERIFIED
        </span>
      </div>
      <div
        className="font-mono tabular"
        style={{
          fontSize: 13,
          padding: "12px 14px",
          background: "var(--paper-alt)",
          border: "1px solid var(--hairline)",
          wordBreak: "break-all",
        }}
      >
        {c.address}
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        <CopyButton text={c.address} />
        <a
          href={explorerAddr(c.address)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono no-underline text-paper"
          style={{
            fontSize: 11,
            padding: "7px 12px",
            background: "var(--ink)",
            borderRadius: 2,
            letterSpacing: "0.04em",
          }}
        >
          View on explorer ↗
        </a>
        <a
          href={c.github}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono no-underline text-ink"
          style={{
            fontSize: 11,
            padding: "7px 12px",
            background: "var(--paper)",
            border: "1px solid var(--hairline)",
            borderRadius: 2,
            letterSpacing: "0.04em",
          }}
        >
          Source ↗
        </a>
      </div>
    </div>
  );
}

function AuditCard({ c }: { c: Contract }) {
  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        background: "var(--paper-alt)",
        padding: "20px 22px",
      }}
    >
      <div className="flex justify-between items-baseline mb-3">
        <div className="eyebrow">Audits · {c.audits.length}</div>
        <Link
          href="/audits"
          className="font-mono no-underline text-ink-soft"
          style={{ fontSize: 10, letterSpacing: "0.08em" }}
        >
          All reports →
        </Link>
      </div>
      <ul className="list-none p-0 m-0 flex flex-col" style={{ gap: 10 }}>
        {c.audits.map((a) => (
          <li
            key={a.ref}
            className="flex justify-between items-center"
            style={{
              padding: "10px 12px",
              background: "var(--paper)",
              border: "1px solid var(--hairline-soft)",
              borderRadius: 2,
            }}
          >
            <div>
              <div
                className="font-serif font-medium"
                style={{ fontSize: 14, letterSpacing: "-0.015em" }}
              >
                {a.firm}
              </div>
              <div
                className="font-mono text-ink-mute mt-0.5"
                style={{ fontSize: 10 }}
              >
                {a.date} · {a.ref}
              </div>
            </div>
            <span
              className="font-mono"
              style={{
                fontSize: 9,
                padding: "3px 8px",
                background: "var(--up-soft)",
                color: "var(--up)",
                border: "1px solid var(--up)",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              PASS
            </span>
          </li>
        ))}
      </ul>
      <div
        className="mt-4"
        style={{
          padding: "10px 12px",
          background: "var(--paper)",
          border: "1px solid var(--hairline-soft)",
        }}
      >
        <div className="eyebrow mb-1">Bug bounty</div>
        <div className="font-mono tabular" style={{ fontSize: 12 }}>
          Up to $500,000 · Immunefi
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="font-mono cursor-pointer transition-colors"
      style={{
        fontSize: 11,
        padding: "7px 12px",
        background: copied ? "var(--up-soft)" : "var(--paper)",
        color: copied ? "var(--up)" : "var(--ink)",
        border: `1px solid ${copied ? "var(--up)" : "var(--hairline)"}`,
        borderRadius: 2,
        letterSpacing: "0.04em",
      }}
    >
      {copied ? "Copied" : "Copy address"}
    </button>
  );
}

function AccessBadge({ tag }: { tag: AccessTag }) {
  const map: Record<AccessTag, { label: string; bg: string; color: string; border: string }> = {
    public: {
      label: "PUBLIC",
      bg: "var(--paper-alt)",
      color: "var(--ink-soft)",
      border: "var(--hairline)",
    },
    external: {
      label: "EXTERNAL",
      bg: "var(--up-soft)",
      color: "var(--up)",
      border: "var(--up)",
    },
    view: {
      label: "VIEW",
      bg: "var(--paper-alt)",
      color: "var(--ink-soft)",
      border: "var(--hairline)",
    },
    onlyOwner: {
      label: "OWNER",
      bg: "var(--amber-soft)",
      color: "var(--amber)",
      border: "var(--amber)",
    },
    restricted: {
      label: "VAULT-ONLY",
      bg: "var(--down-soft)",
      color: "var(--down)",
      border: "var(--down)",
    },
  };
  const m = map[tag];
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 9,
        padding: "3px 7px",
        background: m.bg,
        color: m.color,
        border: `1px solid ${m.border}`,
        letterSpacing: "0.08em",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {m.label}
    </span>
  );
}

function DeploymentTimeline() {
  return (
    <section className="border-b border-hairline">
      <div className="max-w-[1320px] mx-auto px-8 py-7">
        <div className="flex justify-between items-baseline mb-4">
          <div>
            <div className="eyebrow mb-1">
              Deployment timeline · {DEPLOYMENTS.length} events
            </div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              From genesis to <span className="italic">v0.4.2</span>
            </h2>
          </div>
          <span
            className="font-mono text-ink-mute"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            BLOCKS 39,241,007 → 42,917,406
          </span>
        </div>

        <div
          style={{
            border: "1px solid var(--ink)",
            background: "var(--paper)",
          }}
        >
          {DEPLOYMENTS.map((d, i) => {
            const dot =
              d.type === "deploy"
                ? "var(--up)"
                : d.type === "upgrade"
                  ? "var(--amber)"
                  : "var(--ink-soft)";
            return (
              <div
                key={d.block}
                className="grid"
                style={{
                  gridTemplateColumns: "160px 32px 1fr 160px",
                  alignItems: "stretch",
                  borderBottom:
                    i < DEPLOYMENTS.length - 1
                      ? "1px dashed var(--hairline-soft)"
                      : undefined,
                }}
              >
                <div style={{ padding: "16px 18px" }}>
                  <div
                    className="font-mono text-ink-mute"
                    style={{ fontSize: 10, letterSpacing: "0.06em" }}
                  >
                    {d.ts.split(" ")[0]}
                  </div>
                  <div
                    className="font-mono"
                    style={{ fontSize: 11, marginTop: 2 }}
                  >
                    {d.ts.split(" ").slice(1).join(" ")}
                  </div>
                </div>
                <div
                  className="flex flex-col items-center"
                  style={{ padding: "16px 0" }}
                >
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: "50%",
                      background: dot,
                      border: "2px solid var(--paper)",
                      boxShadow: `0 0 0 1px ${dot}`,
                    }}
                  />
                  {i < DEPLOYMENTS.length - 1 && (
                    <span
                      style={{
                        flex: 1,
                        width: 1,
                        background: "var(--hairline)",
                        marginTop: 4,
                      }}
                    />
                  )}
                </div>
                <div style={{ padding: "16px 18px" }}>
                  <div
                    className="font-serif font-medium"
                    style={{ fontSize: 15, letterSpacing: "-0.015em" }}
                  >
                    {d.title}
                  </div>
                  <p
                    className="text-ink-soft m-0 mt-1"
                    style={{ fontSize: 12, lineHeight: 1.5 }}
                  >
                    {d.body}
                  </p>
                </div>
                <div
                  className="text-right"
                  style={{ padding: "16px 18px" }}
                >
                  <div className="eyebrow mb-0.5">Block</div>
                  <div
                    className="font-mono tabular"
                    style={{ fontSize: 13 }}
                  >
                    #{d.block.toLocaleString("en-US")}
                  </div>
                  <span
                    className="font-mono mt-1.5 inline-block"
                    style={{
                      fontSize: 9,
                      padding: "2px 6px",
                      background:
                        d.type === "deploy"
                          ? "var(--up-soft)"
                          : d.type === "upgrade"
                            ? "var(--amber-soft)"
                            : "var(--paper-alt)",
                      color:
                        d.type === "deploy"
                          ? "var(--up)"
                          : d.type === "upgrade"
                            ? "var(--amber)"
                            : "var(--ink-soft)",
                      border: `1px solid ${dot}`,
                      letterSpacing: "0.08em",
                      fontWeight: 600,
                    }}
                  >
                    {d.type.toUpperCase()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ReadingGuide() {
  const items = [
    {
      n: "01",
      title: "Start at EquiFlowVault.sol",
      body: "All state lives here. pledgeAndBorrow() is the canonical entry. Read its preconditions before anything else.",
    },
    {
      n: "02",
      title: "Trace USDG mint paths",
      body: "USDGStable.mint() is unreachable except via the vault. Grep mint() to confirm — there is exactly one call site.",
    },
    {
      n: "03",
      title: "Skim PythPriceAdapter for staleness",
      body: "Every quote is bounded by staleAfter. Liquidators must call updateAndPriceUsd() to refresh before claiming.",
    },
    {
      n: "04",
      title: "Account factory is optional",
      body: "The protocol works with plain EOAs. EquiSmartAccountFactory exists so the UI can bundle approve + pledge into one signature.",
    },
  ];
  return (
    <section className="border-t border-ink bg-paper-alt">
      <div className="max-w-[1320px] mx-auto px-8 py-8">
        <div className="mb-5">
          <div className="eyebrow mb-1.5">How to read this codebase</div>
          <h2
            className="font-serif font-medium m-0"
            style={{ fontSize: 22, letterSpacing: "-0.025em" }}
          >
            Four files. <span className="italic">Read in this order.</span>
          </h2>
        </div>
        <div
          className="grid grid-cols-4 bg-paper"
          style={{ border: "1px solid var(--hairline)" }}
        >
          {items.map((s, i) => (
            <div
              key={s.n}
              style={{
                padding: "20px 22px",
                borderRight:
                  i < items.length - 1
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
                  fontSize: 16,
                  letterSpacing: "-0.015em",
                  margin: "12px 0 8px",
                }}
              >
                {s.title}
              </h4>
              <p
                className="text-ink-soft m-0"
                style={{ fontSize: 12, lineHeight: 1.5 }}
              >
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
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
