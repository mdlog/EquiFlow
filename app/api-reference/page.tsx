"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";

/// EquiFlow public REST + GraphQL surface. The page mirrors what a real API
/// docs page does — every endpoint has a curl, a response, a params table.
/// Numbers below are mocked but proportional to the rest of the protocol.

const BASE_URL = "https://api.equiflow.io/v1";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

type Param = {
  name: string;
  type: string;
  required: boolean;
  desc: string;
};

type Endpoint = {
  method: Method;
  path: string;
  desc: string;
  params: Param[];
  curl: string;
  response: string;
};

type ResourceGroup = {
  id: string;
  name: string;
  tag: string;
  intro: string;
  endpoints: Endpoint[];
};

const GROUPS: ResourceGroup[] = [
  {
    id: "markets",
    name: "/markets",
    tag: "listed assets · oracle metadata",
    intro:
      "Read-only catalogue of every collateral asset the vault supports — LTV bands, oracle binding, listing status. Cached at the edge for 15 s.",
    endpoints: [
      {
        method: "GET",
        path: "/markets",
        desc: "List every asset listed by the vault. Returns LTV, liquidation threshold, stale window, current price.",
        params: [
          { name: "status", type: "string", required: false, desc: "filter by 'listed' | 'paused' | 'delisted'" },
          { name: "limit", type: "int", required: false, desc: "1–200 · default 50" },
          { name: "cursor", type: "string", required: false, desc: "opaque pagination cursor from prev response" },
        ],
        curl: `curl -s ${BASE_URL}/markets?status=listed \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "data": [
    {
      "symbol": "TSLA",
      "token": "0x91f2…b4Ae",
      "feedId": "0x16d…a92c",
      "priceUsd": "256.4180",
      "ltvBps": 6500,
      "liqThresholdBps": 7500,
      "staleAfterSec": 60,
      "totalCollateralUsd": "4218904.55",
      "status": "listed"
    },
    {
      "symbol": "NVDA",
      "token": "0xD81e…F022",
      "priceUsd": "118.9100",
      "ltvBps": 6500,
      "liqThresholdBps": 7500,
      "totalCollateralUsd": "7194028.10",
      "status": "listed"
    }
  ],
  "cursor": null,
  "fetchedAt": "2026-05-20T14:02:11Z"
}`,
      },
      {
        method: "GET",
        path: "/markets/:symbol",
        desc: "Single market detail. Includes 24h price open / high / low / close and per-asset utilisation.",
        params: [
          { name: "symbol", type: "string", required: true, desc: "ticker — TSLA, NVDA, AAPL, …" },
          { name: "window", type: "string", required: false, desc: "'24h' | '7d' | '30d' for the OHLC block" },
        ],
        curl: `curl -s ${BASE_URL}/markets/TSLA?window=24h \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "symbol": "TSLA",
  "token": "0x91f2…b4Ae",
  "priceUsd": "256.4180",
  "ohlc24h": {
    "open": "253.91",
    "high": "258.20",
    "low":  "251.07",
    "close":"256.42"
  },
  "ltvBps": 6500,
  "liqThresholdBps": 7500,
  "borrowedAgainstUsd": "812044.20",
  "collateralLockedUsd":"4218904.55",
  "utilizationBps": 1925
}`,
      },
      {
        method: "GET",
        path: "/markets/:symbol/history",
        desc: "Hourly price + utilisation series. Up to 30 days. Use for charts that don't need WebSocket.",
        params: [
          { name: "symbol", type: "string", required: true, desc: "asset ticker" },
          { name: "from", type: "iso8601", required: false, desc: "inclusive start — defaults to 24h ago" },
          { name: "to", type: "iso8601", required: false, desc: "exclusive end — defaults to now" },
          { name: "resolution", type: "string", required: false, desc: "'1m' | '5m' | '1h' | '1d'" },
        ],
        curl: `curl -s "${BASE_URL}/markets/TSLA/history?resolution=1h&from=2026-05-19T00:00Z" \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "symbol": "TSLA",
  "resolution": "1h",
  "candles": [
    { "ts": "2026-05-19T00:00Z", "o":"251.10","h":"252.40","l":"250.88","c":"252.01","utilBps":1844 },
    { "ts": "2026-05-19T01:00Z", "o":"252.01","h":"253.55","l":"251.94","c":"253.22","utilBps":1851 }
  ],
  "truncated": false
}`,
      },
    ],
  },
  {
    id: "positions",
    name: "/portfolio",
    tag: "borrowers · collateral · health",
    intro:
      "Per-account position snapshots. Mirrors what the vault returns from positionOf() plus a few denormalised columns for the dashboard.",
    endpoints: [
      {
        method: "GET",
        path: "/portfolio/:address",
        desc: "Snapshot for a single borrower. Returns collateral by token, debt, health factor, and the drop required to liquidate.",
        params: [
          { name: "address", type: "address", required: true, desc: "EOA or smart-account address" },
          { name: "include", type: "string[]", required: false, desc: "'pledges' | 'history' | 'oracles' (comma-separated)" },
        ],
        curl: `curl -s "${BASE_URL}/portfolio/0xA73d3F8c4d7b612Ba8e63a89F0e1f2c901c92cC1?include=pledges" \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "user": "0xA73d…2cC1",
  "collateralUsd": "12840.50",
  "borrowedUsd": "7220.00",
  "hf": 1.087,
  "ltvBps": 5625,
  "isLiquidatable": false,
  "dropToLiquidationPct": 7.92,
  "pledges": [
    { "symbol":"TSLA", "amount":"42.5",  "valueUsd":"10897.77" },
    { "symbol":"AAPL", "amount":"10.1",  "valueUsd":"1942.73"  }
  ],
  "asOf": "2026-05-20T14:02:11Z"
}`,
      },
      {
        method: "GET",
        path: "/portfolio",
        desc: "List positions across the protocol with filters. Use for risk dashboards. Same shape as :address but paginated.",
        params: [
          { name: "hfMax", type: "float", required: false, desc: "upper bound on health factor (e.g. 1.05)" },
          { name: "hfMin", type: "float", required: false, desc: "lower bound — useful with hfMax" },
          { name: "minDebtUsd", type: "decimal", required: false, desc: "filter out dust positions" },
          { name: "limit", type: "int", required: false, desc: "1–200 · default 50" },
          { name: "cursor", type: "string", required: false, desc: "opaque pagination cursor" },
        ],
        curl: `curl -s "${BASE_URL}/portfolio?hfMax=1.05&minDebtUsd=500" \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "data": [
    {
      "user":"0xB1f8…77eA","collateralUsd":"4109.20","borrowedUsd":"2820.00",
      "hf":1.012,"isLiquidatable":false,"dropToLiquidationPct":1.18
    },
    {
      "user":"0xCC42…4488","collateralUsd":"8044.10","borrowedUsd":"5610.00",
      "hf":0.994,"isLiquidatable":true,"dropToLiquidationPct":-0.60
    }
  ],
  "cursor": "eyJvIjoxMDB9",
  "totalCount": 1842
}`,
      },
      {
        method: "POST",
        path: "/portfolio/simulate",
        desc: "Server-side simulation. Mirrors vault.simulatePledge / simulateRepay. Returns the post-action position without sending a tx.",
        params: [
          { name: "user", type: "address", required: true, desc: "borrower the simulation is run against" },
          { name: "action", type: "enum", required: true, desc: "'pledge' | 'borrow' | 'repay' | 'withdraw'" },
          { name: "token", type: "address", required: false, desc: "asset · required for pledge / withdraw" },
          { name: "amount", type: "uint256", required: true, desc: "amount in base units (1e18 USDG, 1e18 stock)" },
        ],
        curl: `curl -s -X POST ${BASE_URL}/portfolio/simulate \\
  -H "X-EquiFlow-Key: $EF_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "user":"0xA73d…2cC1",
    "action":"borrow",
    "amount":"500000000000000000000"
  }'`,
        response: `{
  "ok": true,
  "next": {
    "collateralUsd":"12840.50",
    "borrowedUsd":"7720.00",
    "hf":1.018,
    "isLiquidatable":false,
    "dropToLiquidationPct":1.77
  },
  "warnings": ["hf will drop below the 1.05 safety band"]
}`,
      },
    ],
  },
  {
    id: "liquidations",
    name: "/liquidations",
    tag: "events · leaderboard · stream",
    intro:
      "Historical liquidation events and the at-risk feed liquidator bots subscribe to. Same indexer powers /liquidations dashboard.",
    endpoints: [
      {
        method: "GET",
        path: "/liquidations",
        desc: "Liquidation events, newest first. Backed by Liquidated log scans on the vault.",
        params: [
          { name: "from", type: "iso8601", required: false, desc: "inclusive start — defaults to 24h ago" },
          { name: "to", type: "iso8601", required: false, desc: "exclusive end" },
          { name: "liquidator", type: "address", required: false, desc: "filter by liquidator address" },
          { name: "target", type: "address", required: false, desc: "filter by borrower address" },
          { name: "limit", type: "int", required: false, desc: "1–200 · default 50" },
        ],
        curl: `curl -s "${BASE_URL}/liquidations?from=2026-05-19T00:00Z" \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "data": [
    {
      "txHash":"0x88a4…f201",
      "block": 42917401,
      "ts":"2026-05-20T13:58:02Z",
      "liquidator":"0x9b…0a4f",
      "target":"0xCC42…4488",
      "token":"NVDA",
      "debtRepaidUsd":"2805.00",
      "bonusUsd":"140.25"
    }
  ],
  "cursor": null,
  "totalCount": 71
}`,
      },
      {
        method: "GET",
        path: "/liquidations/at-risk",
        desc: "Live at-risk feed. Same data the bot SDK polls. Returns the cheapest-to-liquidate position first.",
        params: [
          { name: "hfMax", type: "float", required: false, desc: "default 1.05" },
          { name: "minDebtUsd", type: "decimal", required: false, desc: "skip dust · default 500" },
          { name: "limit", type: "int", required: false, desc: "1–200 · default 50" },
        ],
        curl: `curl -s "${BASE_URL}/liquidations/at-risk?hfMax=1.00" \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "data": [
    {
      "user":"0xCC42…4488","hf":0.994,"borrowedUsd":"5610.00",
      "bestCollateral":"NVDA","maxRepayUsd":"2805.00","bonusEstUsd":"140.25"
    },
    {
      "user":"0x7d09…2a17","hf":0.998,"borrowedUsd":"1820.10",
      "bestCollateral":"AAPL","maxRepayUsd":"910.05","bonusEstUsd":"45.50"
    }
  ],
  "asOf":"2026-05-20T14:02:11Z"
}`,
      },
      {
        method: "GET",
        path: "/liquidations/leaderboard",
        desc: "Aggregated by liquidator. Volume, count, total bonus earned in the requested window.",
        params: [
          { name: "window", type: "string", required: false, desc: "'24h' | '7d' | '30d'" },
          { name: "type", type: "string", required: false, desc: "'all' | 'bot' | 'eoa'" },
          { name: "limit", type: "int", required: false, desc: "1–100 · default 25" },
        ],
        curl: `curl -s "${BASE_URL}/liquidations/leaderboard?window=7d&type=bot" \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "window":"7d",
  "rows":[
    { "rank":1,"liquidator":"0x9b…0a4f","type":"Bot","liqs":119,"volumeUsd":"402915.00","bonusUsd":"20145.75" },
    { "rank":2,"liquidator":"0x4f…d320","type":"Bot","liqs":87, "volumeUsd":"291042.00","bonusUsd":"14552.10" }
  ]
}`,
      },
    ],
  },
  {
    id: "oracle",
    name: "/oracle",
    tag: "pyth feeds · attestations",
    intro:
      "Pyth feed reads, attestation payloads, and divergence telemetry. The /update endpoint is what liquidators call before claiming to ensure a fresh price.",
    endpoints: [
      {
        method: "GET",
        path: "/oracle/prices",
        desc: "Latest normalised prices across every listed feed. Scaled to 18 decimals.",
        params: [
          { name: "symbols", type: "string[]", required: false, desc: "comma-separated tickers — omit for all" },
        ],
        curl: `curl -s "${BASE_URL}/oracle/prices?symbols=TSLA,NVDA,AAPL" \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "data": [
    { "symbol":"TSLA","priceUsd":"256.4180","publishTime":"2026-05-20T14:02:08Z","ageSec":3 },
    { "symbol":"NVDA","priceUsd":"118.9100","publishTime":"2026-05-20T14:02:07Z","ageSec":4 },
    { "symbol":"AAPL","priceUsd":"192.4400","publishTime":"2026-05-20T14:02:09Z","ageSec":2 }
  ],
  "asOf":"2026-05-20T14:02:11Z"
}`,
      },
      {
        method: "POST",
        path: "/oracle/update",
        desc: "Fetch a fresh Pyth attestation bundle ready to submit on-chain. Returns the calldata for vault.updateAndPriceUsd().",
        params: [
          { name: "symbols", type: "string[]", required: true, desc: "tickers to refresh" },
          { name: "deadlineSec", type: "int", required: false, desc: "expiry on the attestation · default 60" },
        ],
        curl: `curl -s -X POST ${BASE_URL}/oracle/update \\
  -H "X-EquiFlow-Key: $EF_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "symbols":["TSLA","NVDA"] }'`,
        response: `{
  "payload": "0x504e41550100000003b801…",
  "expiresAt":"2026-05-20T14:03:11Z",
  "feeWei":"125000000000000",
  "feeds": [
    { "symbol":"TSLA","priceUsd":"256.4180" },
    { "symbol":"NVDA","priceUsd":"118.9100" }
  ]
}`,
      },
      {
        method: "GET",
        path: "/oracle/divergence",
        desc: "Detect when the on-chain cached price drifts from the Pyth canonical price. Used by the divergence webhook.",
        params: [
          { name: "thresholdBps", type: "int", required: false, desc: "alert threshold · default 75 bps" },
        ],
        curl: `curl -s "${BASE_URL}/oracle/divergence?thresholdBps=50" \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "data": [
    { "symbol":"NVDA","onchainUsd":"117.18","pythUsd":"118.91","deltaBps":146,"status":"alert" }
  ],
  "checkedAt":"2026-05-20T14:02:11Z"
}`,
      },
    ],
  },
  {
    id: "aa",
    name: "/aa",
    tag: "ERC-4337 · sponsored userOps",
    intro:
      "ERC-4337 bundler + paymaster surface. Build a userOp, ask the paymaster to sponsor gas, then submit. The SDK wraps these calls under ef.aa.*",
    endpoints: [
      {
        method: "POST",
        path: "/aa/userop",
        desc: "Build, sponsor, and submit a UserOperation in one round-trip. Returns the bundler hash.",
        params: [
          { name: "sender", type: "address", required: true, desc: "smart-account address (counterfactual ok)" },
          { name: "callData", type: "hex", required: true, desc: "encoded calldata for the vault" },
          { name: "sponsor", type: "bool", required: false, desc: "request gas sponsorship · default true" },
          { name: "signature", type: "hex", required: true, desc: "EIP-712 signature over the userOp hash" },
        ],
        curl: `curl -s -X POST ${BASE_URL}/aa/userop \\
  -H "X-EquiFlow-Key: $EF_KEY" \\
  -H "Content-Type: application/json" \\
  -d @userop.json`,
        response: `{
  "userOpHash":"0x4c…91",
  "bundlerHash":"0xff…02",
  "sponsored": true,
  "estGasUsd":"0.0413",
  "submittedAt":"2026-05-20T14:02:11Z"
}`,
      },
      {
        method: "GET",
        path: "/aa/userop/:hash",
        desc: "Poll a userOp by hash. Returns sealing state, tx hash once mined, and any revert reason.",
        params: [
          { name: "hash", type: "hex", required: true, desc: "userOp hash returned at submission" },
        ],
        curl: `curl -s ${BASE_URL}/aa/userop/0x4c…91 \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "userOpHash":"0x4c…91",
  "status":"sealed",
  "txHash":"0xa8…ee",
  "block": 42917418,
  "gasUsed":"218404",
  "actualGasUsd":"0.0408"
}`,
      },
      {
        method: "GET",
        path: "/aa/account/:owner",
        desc: "Resolve the counterfactual smart-account address for an EOA owner. Idempotent — safe to call before deploy.",
        params: [
          { name: "owner", type: "address", required: true, desc: "EOA that controls the smart account" },
          { name: "salt", type: "uint256", required: false, desc: "default 0 for the canonical account" },
        ],
        curl: `curl -s "${BASE_URL}/aa/account/0xA73d…2cC1?salt=0" \\
  -H "X-EquiFlow-Key: $EF_KEY"`,
        response: `{
  "owner":"0xA73d…2cC1",
  "salt":"0",
  "account":"0x9114…F0AA",
  "deployed": true,
  "nonce":"14"
}`,
      },
    ],
  },
];

const TIER_TABLE: {
  tier: string;
  price: string;
  rpm: number;
  rpd: number;
  burst: number;
  websockets: number;
  features: string;
  tone: "default" | "primary" | "scale";
}[] = [
  {
    tier: "Free",
    price: "$0 / mo",
    rpm: 60,
    rpd: 50_000,
    burst: 100,
    websockets: 1,
    features: "All read endpoints · public testnet · 1 webhook",
    tone: "default",
  },
  {
    tier: "Pro",
    price: "$199 / mo",
    rpm: 600,
    rpd: 1_000_000,
    burst: 1_200,
    websockets: 8,
    features: "/portfolio/simulate · /aa/userop · 25 webhooks · email support",
    tone: "primary",
  },
  {
    tier: "Enterprise",
    price: "custom",
    rpm: 10_000,
    rpd: 25_000_000,
    burst: 30_000,
    websockets: 64,
    features: "Dedicated paymaster · uptime SLA 99.99% · solidity team on call",
    tone: "scale",
  },
];

const WEBHOOKS: {
  event: string;
  desc: string;
  use: string;
  payload: string;
}[] = [
  {
    event: "position.opened",
    desc: "Fires when pledgeAndBorrow seals on-chain.",
    use: "Light up notifications, mark CRM stage, kick off a welcome flow.",
    payload: `{
  "event":"position.opened",
  "id":"evt_01HXX9YA…",
  "data":{
    "user":"0xA73d…2cC1",
    "borrowedUsd":"3200.00",
    "collateralUsd":"12840.50",
    "hf":1.087
  },
  "createdAt":"2026-05-20T14:02:11Z"
}`,
  },
  {
    event: "position.liquidated",
    desc: "Fires once the Liquidated log is indexed (1 block confirm).",
    use: "Pause user-facing flows, notify support, trigger autopilot reload.",
    payload: `{
  "event":"position.liquidated",
  "data":{
    "user":"0xCC42…4488",
    "liquidator":"0x9b…0a4f",
    "debtRepaidUsd":"2805.00",
    "bonusUsd":"140.25",
    "txHash":"0x88a4…f201"
  }
}`,
  },
  {
    event: "oracle.divergence",
    desc: "Fires when on-chain cached price drifts ≥ 75 bps from Pyth.",
    use: "Pause new borrows for the asset · alert risk channel.",
    payload: `{
  "event":"oracle.divergence",
  "data":{
    "symbol":"NVDA",
    "onchainUsd":"117.18",
    "pythUsd":"118.91",
    "deltaBps":146
  }
}`,
  },
  {
    event: "gov.proposal",
    desc: "Fires for every state change on the governor (queued, executed, vetoed).",
    use: "Mirror to Discord · auto-update treasury dashboards.",
    payload: `{
  "event":"gov.proposal",
  "data":{
    "id":"EIP-EF-014",
    "state":"queued",
    "eta":"2026-05-23T14:02:11Z",
    "title":"Lower liquidation bonus to 4.5%"
  }
}`,
  },
];

/// Last 30 days of synthetic health bars. Two amber days simulate small
/// incidents — keeps the strip looking real instead of a wall of green.
const UPTIME_BARS: ("ok" | "warn" | "down")[] = [
  "ok","ok","ok","ok","ok","ok","ok","ok",
  "ok","warn","ok","ok","ok","ok","ok","ok",
  "ok","ok","ok","ok","ok","ok","warn","ok",
  "ok","ok","ok","ok","ok","ok",
];

export default function ApiReferencePage() {
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
              border: "1px solid var(--up)",
              background: "var(--up-soft)",
              color: "var(--ink)",
            }}
          >
            <span
              className="inline-block"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--up)",
                animation: "ef-pulse 1.8s ease-out infinite",
              }}
            />
            OPERATIONAL · 99.97% uptime · 30d
          </span>
        }
      />

      <div
        className="border-b border-hairline-soft"
        style={{ padding: "12px 32px", background: "var(--amber-soft)" }}
      >
        <span style={{ fontSize: 12, letterSpacing: "0.06em" }} className="text-ink-soft font-mono uppercase">
          ILLUSTRATIVE · API data shown is for demonstration. The API domain and responses are illustrative.
        </span>
      </div>

      <Hero />
      <KpiStrip />
      <AuthSection />
      <EndpointCatalogue />
      <RateLimitPanel />
      <WebhooksSection />
      <StatusPanel />
      <CtaStrip />

      <SiteFooter />
    </div>
  );
}

/* ─── Hero ──────────────────────────────────────────────────── */

function Hero() {
  const [copied, setCopied] = useState(false);
  return (
    <section className="border-b border-ink">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 pt-7 pb-7">
        <div
          className="grid"
          style={{ gridTemplateColumns: "1.35fr 1fr", gap: 36 }}
        >
          <div>
            <div className="eyebrow mb-2">
              Developers · REST + GraphQL · {GROUPS.length} resource groups · OpenAPI 3.1
            </div>
            <h1
              className="font-serif font-medium m-0"
              style={{
                fontSize: 38,
                letterSpacing: "-0.03em",
                lineHeight: 1.02,
              }}
            >
              The EquiFlow API · <span className="italic">one base URL</span>
            </h1>
            <p
              className="text-ink-soft mt-3 max-w-[600px]"
              style={{ fontSize: 14, lineHeight: 1.6 }}
            >
              Everything the dashboard reads is exposed here. Markets, positions,
              liquidations, oracle, account abstraction — same indexer, same
              numbers, no auth dance. Keys ship signed in a single header.
            </p>

            <div
              className="flex items-stretch mt-5 max-w-[560px]"
              style={{ border: "1px solid var(--hairline)", borderRadius: 2 }}
            >
              <span
                className="font-mono inline-flex items-center"
                style={{
                  padding: "10px 14px",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  background: "var(--paper-alt)",
                  color: "var(--ink-mute)",
                  borderRight: "1px solid var(--hairline)",
                }}
              >
                BASE URL
              </span>
              <code
                className="font-mono tabular flex-1 flex items-center"
                style={{
                  padding: "10px 14px",
                  fontSize: 14,
                  background: "var(--paper)",
                  color: "var(--ink)",
                }}
              >
                {BASE_URL}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(BASE_URL);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                }}
                className="font-mono cursor-pointer transition-colors"
                style={{
                  padding: "0 16px",
                  fontSize: 11,
                  background: copied ? "var(--up-soft)" : "var(--ink)",
                  color: copied ? "var(--up)" : "var(--paper)",
                  border: "none",
                  letterSpacing: "0.06em",
                }}
              >
                {copied ? "COPIED" : "COPY"}
              </button>
            </div>

            <div className="flex gap-6 mt-6 flex-wrap">
              {[
                ["Resources", `${GROUPS.length}`, "markets · positions · liquidations · oracle · aa"],
                ["Endpoints", `${GROUPS.reduce((n, g) => n + g.endpoints.length, 0)}`, "documented · OpenAPI 3.1 spec"],
                ["Webhooks", "4 events", "HMAC-SHA256 signed"],
              ].map(([k, v, sub]) => (
                <div key={k as string}>
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
            <div className="eyebrow mb-2">First call · 60 seconds</div>
            <CodeBlock>{`# Get every listed asset
curl -s ${BASE_URL}/markets \\
  -H "X-EquiFlow-Key: $EF_KEY" | jq '.data[].symbol'

# → "TSLA"
# → "NVDA"
# → "AAPL"
# → "MSFT"
# → "GOOGL"
# → "AMZN"
# → "META"
# → "SPY"`}</CodeBlock>
            <div
              className="mt-3 font-mono text-ink-mute"
              style={{ fontSize: 10, letterSpacing: "0.06em" }}
            >
              {">>"} 8 assets · 142 ms · cached at edge · no rate-limit hit
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── KPI strip ─────────────────────────────────────────────── */

function KpiStrip() {
  const cells: { label: string; value: string; sub: string; color?: string; last?: boolean }[] = [
    { label: "Requests · 24h", value: "12.4M", sub: "across 5 regions · edge + origin" },
    { label: "p99 latency", value: "84ms", sub: "GET /markets · global median 31ms", color: "var(--up)" },
    { label: "Error rate · 7d", value: "0.034%", sub: "5xx + 502 · excludes 429", color: "var(--up)" },
    { label: "Uptime · 30d", value: "99.97%", sub: "11.2 min total downtime", color: "var(--up)", last: true },
  ];
  return (
    <section className="bg-paper-alt border-b border-hairline">
      <div className="max-w-[1320px] mx-auto grid grid-cols-4">
        {cells.map((c) => (
          <div
            key={c.label}
            style={{
              padding: "18px 24px",
              borderRight: c.last
                ? undefined
                : "1px solid var(--hairline-soft)",
            }}
          >
            <div className="eyebrow mb-2.5">{c.label}</div>
            <div
              className="font-serif font-medium tabular"
              style={{
                fontSize: 30,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: c.color ?? "var(--ink)",
              }}
            >
              {c.value}
            </div>
            <div
              className="font-mono tabular text-ink-mute mt-2"
              style={{ fontSize: 10 }}
            >
              {c.sub}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Authentication ────────────────────────────────────────── */

function AuthSection() {
  return (
    <section className="border-b border-hairline">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8">
        <div
          className="grid"
          style={{ gridTemplateColumns: "1fr 1.3fr", gap: 36 }}
        >
          <div>
            <div className="eyebrow mb-1.5">Authentication · one header</div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 26, letterSpacing: "-0.025em" }}
            >
              An <span className="italic">API key</span> in the X-EquiFlow-Key header.
            </h2>
            <p
              className="text-ink-soft mt-3"
              style={{ fontSize: 13.5, lineHeight: 1.6 }}
            >
              Generate a key from the developer dashboard. Keys are scoped — a
              read-only key cannot hit /aa/userop. Rotate them anytime; old
              keys keep working for 5 minutes after rotation.
            </p>
            <ul
              className="list-none p-0 m-0 mt-4 flex flex-col"
              style={{ gap: 10 }}
            >
              {[
                ["Header name", "X-EquiFlow-Key"],
                ["Key format", "ef_live_… (live) · ef_test_… (testnet)"],
                ["Scopes", "read · simulate · sponsor · webhook"],
                ["Rotation", "instant · 5min grace on prev key"],
              ].map(([k, v]) => (
                <li
                  key={k}
                  className="flex justify-between items-center"
                  style={{
                    padding: "10px 12px",
                    border: "1px solid var(--hairline)",
                    background: "var(--paper-alt)",
                  }}
                >
                  <span className="eyebrow">{k}</span>
                  <span
                    className="font-mono tabular"
                    style={{ fontSize: 12 }}
                  >
                    {v}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div
              className="flex justify-between items-center mb-1.5 flex-wrap gap-2"
            >
              <span
                className="font-mono text-ink-mute"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                {">>"} EXAMPLES / auth.sh
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: 10,
                  padding: "3px 8px",
                  background: "var(--down-soft)",
                  color: "var(--down)",
                  border: "1px solid var(--down)",
                  letterSpacing: "0.08em",
                  fontWeight: 600,
                }}
              >
                NEVER COMMIT KEYS
              </span>
            </div>
            <CodeBlock>{`# 1 · export the key once per shell
export EF_KEY="ef_live_a09b3c4d2…"

# 2 · authenticated GET
curl -s ${BASE_URL}/portfolio/0xA73d…2cC1 \\
  -H "X-EquiFlow-Key: $EF_KEY"

# 3 · scope check — 403 if your key is read-only
curl -s -X POST ${BASE_URL}/aa/userop \\
  -H "X-EquiFlow-Key: $EF_KEY" \\
  -H "Content-Type: application/json" \\
  -d @userop.json

# missing / invalid key
# → HTTP/2 401
# → { "code":"unauthorized","message":"missing X-EquiFlow-Key" }

# scope mismatch
# → HTTP/2 403
# → { "code":"forbidden","required":"sponsor","have":["read"] }`}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Endpoint catalogue ────────────────────────────────────── */

function EndpointCatalogue() {
  const [active, setActive] = useState<string>(GROUPS[0].id);
  const current = useMemo(
    () => GROUPS.find((g) => g.id === active) ?? GROUPS[0],
    [active],
  );

  const totalEndpoints = GROUPS.reduce((n, g) => n + g.endpoints.length, 0);

  return (
    <section className="border-b border-hairline bg-paper-alt">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8">
        <div className="flex justify-between items-baseline mb-4 flex-wrap gap-3">
          <div>
            <div className="eyebrow mb-1">
              Endpoint catalogue · {totalEndpoints} entries · grouped by resource
            </div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 26, letterSpacing: "-0.025em" }}
            >
              Every route, <span className="italic">documented</span>.
            </h2>
          </div>
          <div className="flex gap-1 p-[3px] border border-hairline bg-paper rounded-[2px]">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                onClick={() => setActive(g.id)}
                className="border-0 px-3 py-1.5 cursor-pointer transition-colors font-mono"
                style={{
                  fontSize: 12,
                  background: active === g.id ? "var(--ink)" : "transparent",
                  color: active === g.id ? "var(--paper)" : "var(--ink-soft)",
                  borderRadius: 2,
                  letterSpacing: "0.02em",
                }}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            border: "1px solid var(--ink)",
            background: "var(--paper)",
            padding: "20px 24px",
          }}
        >
          <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
            <div>
              <div
                className="font-mono"
                style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--ink-mute)" }}
              >
                {current.tag.toUpperCase()}
              </div>
              <h3
                className="font-serif font-medium m-0 mt-1"
                style={{ fontSize: 22, letterSpacing: "-0.02em" }}
              >
                {current.name}
              </h3>
            </div>
            <span
              className="font-mono text-ink-mute"
              style={{ fontSize: 10, letterSpacing: "0.06em" }}
            >
              {current.endpoints.length} ENDPOINTS · OPENAPI ↗
            </span>
          </div>
          <p
            className="text-ink-soft m-0 mb-5 max-w-[820px]"
            style={{ fontSize: 13, lineHeight: 1.6 }}
          >
            {current.intro}
          </p>

          <div className="flex flex-col" style={{ gap: 26 }}>
            {current.endpoints.map((ep) => (
              <EndpointCard key={ep.method + ep.path} ep={ep} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  return (
    <article
      style={{
        border: "1px solid var(--hairline)",
        background: "var(--paper)",
      }}
    >
      {/* header */}
      <header
        className="flex items-center gap-3 flex-wrap"
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--paper-alt)",
        }}
      >
        <MethodBadge method={ep.method} />
        <code
          className="font-mono"
          style={{ fontSize: 13, letterSpacing: "-0.005em" }}
        >
          {ep.path}
        </code>
        <span className="flex-1" />
        <span
          className="text-ink-soft"
          style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 540 }}
        >
          {ep.desc}
        </span>
      </header>

      {/* params */}
      {ep.params.length > 0 && (
        <div style={{ padding: "12px 16px", borderBottom: "1px dashed var(--hairline-soft)" }}>
          <div className="eyebrow mb-2">
            {ep.method === "GET" || ep.method === "DELETE"
              ? "Query / path params"
              : "Body / path params"}{" "}
            · {ep.params.length}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--hairline)" }}>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Required</Th>
                <Th>Description</Th>
              </tr>
            </thead>
            <tbody>
              {ep.params.map((p, i) => (
                <tr
                  key={p.name}
                  style={{
                    borderBottom:
                      i < ep.params.length - 1
                        ? "1px dashed var(--hairline-soft)"
                        : undefined,
                  }}
                >
                  <td style={{ padding: "9px 12px" }}>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 12,
                        background: "var(--paper-alt)",
                        padding: "2px 6px",
                        fontWeight: 500,
                      }}
                    >
                      {p.name}
                    </span>
                  </td>
                  <td
                    className="font-mono text-ink-soft"
                    style={{ padding: "9px 12px", fontSize: 11.5 }}
                  >
                    {p.type}
                  </td>
                  <td
                    style={{ padding: "9px 12px" }}
                  >
                    {p.required ? (
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 9,
                          padding: "2px 7px",
                          background: "var(--down-soft)",
                          color: "var(--down)",
                          border: "1px solid var(--down)",
                          letterSpacing: "0.08em",
                          fontWeight: 600,
                        }}
                      >
                        REQUIRED
                      </span>
                    ) : (
                      <span
                        className="font-mono text-ink-mute"
                        style={{
                          fontSize: 9,
                          letterSpacing: "0.08em",
                        }}
                      >
                        optional
                      </span>
                    )}
                  </td>
                  <td
                    className="text-ink-soft"
                    style={{ padding: "9px 12px", fontSize: 12, lineHeight: 1.5 }}
                  >
                    {p.desc}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* code · request + response */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: "1fr 1fr",
          borderTop: "1px dashed var(--hairline-soft)",
        }}
      >
        <div style={{ borderRight: "1px solid var(--hairline)", padding: "14px 16px" }}>
          <div
            className="font-mono text-ink-mute mb-2"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            {">>"} REQUEST
          </div>
          <CodeBlock small>{ep.curl}</CodeBlock>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <div
            className="font-mono text-ink-mute mb-2 flex items-center justify-between"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            <span>{">>"} RESPONSE · 200 OK</span>
            <span style={{ color: "var(--up)" }}>application/json</span>
          </div>
          <CodeBlock small>{ep.response}</CodeBlock>
        </div>
      </div>
    </article>
  );
}

function MethodBadge({ method }: { method: Method }) {
  const map: Record<Method, { bg: string; color: string; border: string }> = {
    GET: {
      bg: "var(--up-soft)",
      color: "var(--up)",
      border: "var(--up)",
    },
    POST: {
      bg: "var(--ink)",
      color: "var(--paper)",
      border: "var(--ink)",
    },
    PATCH: {
      bg: "var(--amber-soft)",
      color: "var(--amber)",
      border: "var(--amber)",
    },
    DELETE: {
      bg: "var(--down-soft)",
      color: "var(--down)",
      border: "var(--down)",
    },
  };
  const m = map[method];
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 9,
        padding: "4px 8px",
        background: m.bg,
        color: m.color,
        border: `1px solid ${m.border}`,
        letterSpacing: "0.14em",
        fontWeight: 700,
        minWidth: 56,
        textAlign: "center",
        borderRadius: 2,
      }}
    >
      {method}
    </span>
  );
}

/* ─── Rate limits ───────────────────────────────────────────── */

function RateLimitPanel() {
  return (
    <section className="border-b border-hairline">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8">
        <div className="flex justify-between items-baseline mb-4 flex-wrap gap-3">
          <div>
            <div className="eyebrow mb-1">
              Rate limits · 3 tiers · token-bucket with burst
            </div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Pick a tier. <span className="italic">Watch the headers.</span>
            </h2>
          </div>
          <span
            className="font-mono text-ink-mute"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            X-RATELIMIT-* ON EVERY RESPONSE
          </span>
        </div>

        <div
          className="grid grid-cols-3 bg-paper"
          style={{ border: "1px solid var(--ink)" }}
        >
          {TIER_TABLE.map((t, i) => {
            const isPrimary = t.tone === "primary";
            return (
              <div
                key={t.tier}
                style={{
                  padding: "22px 24px",
                  background: isPrimary ? "var(--paper-alt)" : "var(--paper)",
                  borderRight:
                    i < TIER_TABLE.length - 1
                      ? "1px solid var(--hairline)"
                      : undefined,
                  position: "relative",
                }}
              >
                {isPrimary && (
                  <span
                    className="font-mono"
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      fontSize: 9,
                      padding: "3px 9px",
                      background: "var(--ink)",
                      color: "var(--paper)",
                      letterSpacing: "0.12em",
                      fontWeight: 600,
                    }}
                  >
                    MOST DEVS
                  </span>
                )}
                <div className="flex justify-between items-baseline">
                  <h3
                    className="font-serif font-medium m-0"
                    style={{ fontSize: 22, letterSpacing: "-0.025em" }}
                  >
                    {t.tier}
                  </h3>
                  <span
                    className="font-mono tabular"
                    style={{ fontSize: 13, color: "var(--ink-soft)" }}
                  >
                    {t.price}
                  </span>
                </div>
                <div
                  className="mt-4 flex flex-col"
                  style={{ gap: 8 }}
                >
                  <Row label="Per minute" value={`${t.rpm.toLocaleString()} req`} />
                  <Row label="Per day" value={`${t.rpd.toLocaleString()} req`} />
                  <Row label="Burst" value={`${t.burst.toLocaleString()} req`} />
                  <Row label="WebSockets" value={`${t.websockets} concurrent`} />
                </div>
                <p
                  className="text-ink-soft m-0 mt-4"
                  style={{ fontSize: 12, lineHeight: 1.5 }}
                >
                  {t.features}
                </p>
                <button
                  className="font-mono w-full mt-5 cursor-pointer transition-colors"
                  style={{
                    padding: "9px 12px",
                    fontSize: 12,
                    background: isPrimary ? "var(--ink)" : "var(--paper)",
                    color: isPrimary ? "var(--paper)" : "var(--ink)",
                    border: isPrimary ? "none" : "1px solid var(--hairline)",
                    borderRadius: 2,
                    letterSpacing: "0.04em",
                  }}
                >
                  {t.tier === "Enterprise" ? "Talk to sales →" : "Start with free →"}
                </button>
              </div>
            );
          })}
        </div>

        {/* headers explainer */}
        <div
          className="mt-5 grid"
          style={{ gridTemplateColumns: "1fr 1.2fr", gap: 24 }}
        >
          <div
            style={{
              border: "1px solid var(--hairline)",
              background: "var(--paper-alt)",
              padding: "18px 22px",
            }}
          >
            <div className="eyebrow mb-2">How the headers work</div>
            <p
              className="text-ink-soft m-0"
              style={{ fontSize: 12.5, lineHeight: 1.6 }}
            >
              Every response carries three headers describing the bucket. When
              the bucket drains, the API returns{" "}
              <span className="font-mono" style={{ fontSize: 11, background: "var(--paper)", padding: "1px 5px" }}>
                429 Too Many Requests
              </span>{" "}
              with a Retry-After in seconds. Burst recharges at the per-minute
              rate.
            </p>
            <ul className="list-none p-0 m-0 mt-4 flex flex-col" style={{ gap: 8 }}>
              {[
                ["X-RateLimit-Limit", "ceiling for this tier"],
                ["X-RateLimit-Remaining", "tokens left in the bucket"],
                ["X-RateLimit-Reset", "epoch when full ceiling returns"],
                ["Retry-After", "set on 429 · seconds to wait"],
              ].map(([h, d]) => (
                <li key={h} className="flex justify-between gap-3">
                  <span
                    className="font-mono"
                    style={{ fontSize: 12, fontWeight: 500 }}
                  >
                    {h}
                  </span>
                  <span
                    className="font-mono text-ink-soft text-right"
                    style={{ fontSize: 11 }}
                  >
                    {d}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <CodeBlock>{`# 1 · normal response
HTTP/2 200
X-RateLimit-Limit:     600
X-RateLimit-Remaining: 593
X-RateLimit-Reset:     1747746541
Content-Type:          application/json

# 2 · 429 once the bucket drains
HTTP/2 429
X-RateLimit-Limit:     600
X-RateLimit-Remaining: 0
X-RateLimit-Reset:     1747746601
Retry-After:           14

{
  "code":"rate_limited",
  "message":"bucket exhausted",
  "tier":"pro",
  "retryAfterSec":14
}`}</CodeBlock>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span
        className="font-mono text-ink-mute"
        style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        {label}
      </span>
      <span className="font-mono tabular" style={{ fontSize: 13, fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}

/* ─── Webhooks ──────────────────────────────────────────────── */

function WebhooksSection() {
  return (
    <section className="border-b border-hairline bg-paper-alt">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8">
        <div className="flex justify-between items-baseline mb-4 flex-wrap gap-3">
          <div>
            <div className="eyebrow mb-1">
              Webhooks · {WEBHOOKS.length} events · HMAC-SHA256 signed
            </div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              Push, don't <span className="italic">poll</span>.
            </h2>
          </div>
          <span
            className="font-mono text-ink-mute"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            DELIVERED AT-LEAST-ONCE · 6 RETRIES OVER 24H
          </span>
        </div>

        {/* events table */}
        <div style={{ border: "1px solid var(--ink)", background: "var(--paper)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ink)", background: "var(--paper-alt)" }}>
                <Th>Event</Th>
                <Th>When it fires</Th>
                <Th>Suggested handler</Th>
                <Th>Payload preview</Th>
              </tr>
            </thead>
            <tbody>
              {WEBHOOKS.map((w, i) => (
                <tr
                  key={w.event}
                  style={{
                    borderBottom:
                      i < WEBHOOKS.length - 1
                        ? "1px dashed var(--hairline-soft)"
                        : undefined,
                  }}
                >
                  <td style={{ padding: "13px 14px", verticalAlign: "top" }}>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 12,
                        background: "var(--paper-alt)",
                        padding: "3px 7px",
                        fontWeight: 500,
                        letterSpacing: "-0.005em",
                      }}
                    >
                      {w.event}
                    </span>
                  </td>
                  <td
                    className="text-ink-soft"
                    style={{
                      padding: "13px 14px",
                      verticalAlign: "top",
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      maxWidth: 240,
                    }}
                  >
                    {w.desc}
                  </td>
                  <td
                    className="text-ink-soft"
                    style={{
                      padding: "13px 14px",
                      verticalAlign: "top",
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      maxWidth: 280,
                    }}
                  >
                    {w.use}
                  </td>
                  <td
                    style={{
                      padding: "0",
                      verticalAlign: "top",
                      borderLeft: "1px dashed var(--hairline-soft)",
                      width: 380,
                    }}
                  >
                    <CodeBlock small flat>{w.payload}</CodeBlock>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* signing */}
        <div
          className="mt-5 grid"
          style={{ gridTemplateColumns: "1fr 1.2fr", gap: 24 }}
        >
          <div
            style={{
              border: "1px solid var(--hairline)",
              background: "var(--paper)",
              padding: "18px 22px",
            }}
          >
            <div className="eyebrow mb-2">Signing · X-EquiFlow-Signature</div>
            <p
              className="text-ink-soft m-0"
              style={{ fontSize: 12.5, lineHeight: 1.6 }}
            >
              Every delivery includes a header of the form{" "}
              <span
                className="font-mono"
                style={{ fontSize: 11, background: "var(--paper-alt)", padding: "1px 5px" }}
              >
                t=…,v1=…
              </span>{" "}
              — concatenate the timestamp + body, HMAC-SHA256 with your endpoint
              secret, compare in constant time. Reject deliveries older than
              5 minutes to defeat replay.
            </p>
            <ul className="list-none p-0 m-0 mt-4 flex flex-col" style={{ gap: 7 }}>
              {[
                ["Algorithm", "HMAC-SHA256"],
                ["Header", "X-EquiFlow-Signature"],
                ["Timestamp tolerance", "±300 s"],
                ["Replay protection", "id (idempotent · 24h dedup)"],
              ].map(([k, v]) => (
                <li key={k} className="flex justify-between gap-3">
                  <span
                    className="font-mono text-ink-mute"
                    style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase" }}
                  >
                    {k}
                  </span>
                  <span className="font-mono tabular" style={{ fontSize: 12, fontWeight: 500 }}>
                    {v}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <CodeBlock>{`// Express handler — verify, then dispatch
import crypto from "node:crypto";

app.post("/wh/equiflow", express.raw({ type: "*/*" }), (req, res) => {
  const sig = req.header("X-EquiFlow-Signature") ?? "";
  const [tPart, v1Part] = sig.split(",");
  const ts = Number(tPart.split("=")[1]);
  const v1 = v1Part.split("=")[1];

  if (Math.abs(Date.now() / 1000 - ts) > 300) return res.sendStatus(408);

  const signed = \`\${ts}.\${req.body.toString("utf8")}\`;
  const expected = crypto
    .createHmac("sha256", process.env.EF_WH_SECRET!)
    .update(signed)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) {
    return res.sendStatus(401);
  }

  const { event, data } = JSON.parse(req.body.toString("utf8"));
  // dispatch …
  res.sendStatus(200);
});`}</CodeBlock>
        </div>
      </div>
    </section>
  );
}

/* ─── Status / uptime ───────────────────────────────────────── */

function StatusPanel() {
  /// Arc gauge geometry — 220 wide, 130 tall, semicircle 0 → 180°.
  const W = 220;
  const H = 130;
  const cx = W / 2;
  const cy = H - 8;
  const r = 90;
  const uptimePct = 99.97;
  /// sweep proportion of the semicircle.
  const angle = (uptimePct / 100) * Math.PI;
  /// arc end point (start at left, π radians from start at right).
  const ex = cx - r * Math.cos(angle);
  const ey = cy - r * Math.sin(angle);
  /// background path = full semicircle.
  const bgPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  /// uptime path = partial.
  const upPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex} ${ey}`;

  return (
    <section className="border-b border-hairline">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8">
        <div className="flex justify-between items-baseline mb-4">
          <div>
            <div className="eyebrow mb-1">Status · 30 day window</div>
            <h2
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              <span className="italic">Operational.</span> No active incidents.
            </h2>
          </div>
          <Link
            href="#"
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
            status.equiflow.io ↗
          </Link>
        </div>

        <div
          className="grid bg-paper"
          style={{
            gridTemplateColumns: "260px 1fr",
            border: "1px solid var(--ink)",
          }}
        >
          {/* gauge */}
          <div
            className="flex flex-col items-center justify-center"
            style={{
              padding: "20px 20px",
              borderRight: "1px solid var(--hairline)",
              background: "var(--paper-alt)",
            }}
          >
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
              <path
                d={bgPath}
                fill="none"
                stroke="var(--hairline)"
                strokeWidth="10"
                strokeLinecap="butt"
              />
              <path
                d={upPath}
                fill="none"
                stroke="var(--up)"
                strokeWidth="10"
                strokeLinecap="butt"
              />
              {/* tick marks for thresholds */}
              {[0, 0.5, 1].map((f, i) => {
                const a = f * Math.PI;
                const x1 = cx - (r - 14) * Math.cos(a);
                const y1 = cy - (r - 14) * Math.sin(a);
                const x2 = cx - (r + 6) * Math.cos(a);
                const y2 = cy - (r + 6) * Math.sin(a);
                return (
                  <line
                    key={i}
                    x1={x1}
                    x2={x2}
                    y1={y1}
                    y2={y2}
                    stroke="var(--ink-mute)"
                    strokeWidth="1"
                  />
                );
              })}
              <text
                x={cx}
                y={cy - 14}
                textAnchor="middle"
                fontFamily="var(--font-serif)"
                fontSize="26"
                fontWeight="500"
                letterSpacing="-0.025em"
                fill="var(--ink)"
              >
                {uptimePct.toFixed(2)}%
              </text>
              <text
                x={cx}
                y={cy + 2}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="9"
                letterSpacing="0.16em"
                fill="var(--ink-mute)"
              >
                UPTIME · 30D
              </text>
            </svg>
            <div
              className="mt-2 flex items-center gap-1.5 font-mono"
              style={{ fontSize: 10, color: "var(--up)", letterSpacing: "0.06em" }}
            >
              <span
                className="inline-block"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--up)",
                }}
              />
              ABOVE 99.95% SLA
            </div>
          </div>

          {/* daily strip */}
          <div style={{ padding: "20px 24px" }}>
            <div className="flex justify-between items-baseline mb-3">
              <div>
                <div className="eyebrow mb-1">Daily health · 30 days</div>
                <div
                  className="font-mono"
                  style={{ fontSize: 12, color: "var(--ink-soft)" }}
                >
                  28 nominal · 2 degraded · 0 outage
                </div>
              </div>
              <div className="flex items-center gap-3">
                {[
                  ["nominal", "var(--up)"],
                  ["degraded", "var(--amber)"],
                  ["outage", "var(--down)"],
                ].map(([l, c]) => (
                  <span
                    key={l}
                    className="inline-flex items-center gap-1.5 font-mono text-ink-mute"
                    style={{ fontSize: 10 }}
                  >
                    <span
                      className="inline-block"
                      style={{ width: 8, height: 8, background: c }}
                    />
                    {l}
                  </span>
                ))}
              </div>
            </div>

            <svg
              viewBox="0 0 600 84"
              width="100%"
              style={{ display: "block" }}
              preserveAspectRatio="none"
            >
              {UPTIME_BARS.map((b, i) => {
                const w = 600 / UPTIME_BARS.length;
                const x = i * w;
                const color =
                  b === "ok"
                    ? "var(--up)"
                    : b === "warn"
                      ? "var(--amber)"
                      : "var(--down)";
                /// random-ish height so the strip looks real not stamped.
                const h = b === "ok" ? 56 + ((i * 7) % 14) : 38;
                return (
                  <rect
                    key={i}
                    x={x + 2}
                    y={84 - h - 12}
                    width={w - 4}
                    height={h}
                    fill={color}
                    opacity={b === "ok" ? 0.9 : 1}
                  />
                );
              })}
              {[0, 7, 14, 21, 29].map((i) => (
                <text
                  key={i}
                  x={i * (600 / UPTIME_BARS.length) + 600 / UPTIME_BARS.length / 2}
                  y={82}
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fill="var(--ink-mute)"
                  textAnchor="middle"
                >
                  {i === 29 ? "today" : `−${29 - i}d`}
                </text>
              ))}
            </svg>

            {/* incident strip */}
            <div
              className="mt-4 grid"
              style={{
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              {[
                {
                  d: "−21d",
                  title: "Degraded · oracle update latency",
                  body: "Pyth attestations stalled for 7 min. No reads failed. Mitigated by adapter fallback cache.",
                  level: "warn" as const,
                },
                {
                  d: "−7d",
                  title: "Degraded · /aa/userop queue depth",
                  body: "Bundler queue spiked to 380 ops. 4 ops dropped + retried. Capacity increased post-incident.",
                  level: "warn" as const,
                },
              ].map((inc) => (
                <div
                  key={inc.title}
                  style={{
                    padding: "12px 14px",
                    background: "var(--paper-alt)",
                    border: "1px solid var(--hairline)",
                  }}
                >
                  <div className="flex justify-between items-baseline mb-1">
                    <span
                      className="font-mono tabular text-ink-mute"
                      style={{ fontSize: 10, letterSpacing: "0.06em" }}
                    >
                      {inc.d}
                    </span>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 9,
                        padding: "2px 6px",
                        background: "var(--amber-soft)",
                        color: "var(--amber)",
                        border: "1px solid var(--amber)",
                        letterSpacing: "0.08em",
                        fontWeight: 600,
                      }}
                    >
                      DEGRADED
                    </span>
                  </div>
                  <div
                    className="font-serif font-medium"
                    style={{ fontSize: 13.5, letterSpacing: "-0.015em" }}
                  >
                    {inc.title}
                  </div>
                  <p
                    className="text-ink-soft m-0 mt-1"
                    style={{ fontSize: 11.5, lineHeight: 1.5 }}
                  >
                    {inc.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Closing CTA ───────────────────────────────────────────── */

function CtaStrip() {
  return (
    <section className="border-t border-ink bg-paper-alt">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8">
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
              READY TO SHIP?
            </span>
            <span style={{ fontSize: 14, lineHeight: 1.5 }}>
              Generate a key and you're talking to the vault in under a minute.{" "}
              <span style={{ opacity: 0.7 }}>
                The OpenAPI 3.1 spec generates a typed client for any language —
                or grab the TypeScript SDK and skip the curl phase.
              </span>
            </span>
          </div>
          <div className="flex gap-2">
            <Link
              href="/sdk"
              className="font-medium no-underline text-paper"
              style={{
                padding: "9px 16px",
                fontSize: 12,
                background: "transparent",
                border: "1px solid rgba(250, 248, 242, 0.3)",
                borderRadius: 2,
              }}
            >
              TypeScript SDK
            </Link>
            <a
              href="#"
              className="font-medium no-underline text-ink"
              style={{
                padding: "9px 16px",
                fontSize: 12,
                background: "var(--paper)",
                border: "none",
                borderRadius: 2,
              }}
            >
              Get an API key ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Shared helpers ────────────────────────────────────────── */

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
