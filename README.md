<p align="center">
  <img src="public/logo-equiflow.png" alt="EquiFlow" width="120" />
</p>

<h1 align="center">EquiFlow</h1>

<p align="center">
  <strong>Yield-generating stock collateralization on Robinhood Chain (Arbitrum Orbit L3).</strong>
</p>

<p align="center">
  Pledge tokenized US equities as collateral, borrow the USDG stablecoin, and put the proceeds to work — without selling a share. One-signature pledges and sponsored gas when you use the built-in smart wallet.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity&logoColor=white" alt="Solidity" />
  <img src="https://img.shields.io/badge/Foundry-Forge-DEA584?logo=ethereum&logoColor=white" alt="Foundry" />
  <img src="https://img.shields.io/badge/Arbitrum-Orbit_L3-28A0F0?logo=arbitrum&logoColor=white" alt="Arbitrum" />
  <img src="https://img.shields.io/badge/Pyth-Network-7B61FF?logo=pyth&logoColor=white" alt="Pyth" />
  <img src="https://img.shields.io/badge/ERC--4337-Account_Abstraction-FF6B00?logo=ethereum&logoColor=white" alt="ERC-4337" />
  <img src="https://img.shields.io/badge/wagmi-3-1C1C1C?logo=wagmi&logoColor=white" alt="wagmi" />
  <img src="https://img.shields.io/badge/viem-2-FFC517?logoColor=black" alt="viem" />
  <img src="https://img.shields.io/badge/audit-7%20passes-success" alt="audit pass count" />
  <img src="https://img.shields.io/badge/tests-168%20passing-brightgreen" alt="test count" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license" />
</p>

> ⚠️ **Testnet demo.** EquiFlow runs on Robinhood Chain **Testnet** for demonstration and educational purposes. No real funds are involved, some figures are illustrative, and nothing here is financial advice. See [Disclaimer](#disclaimer).

---

## Table of contents

- [Overview](#overview)
- [Status](#status)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [Smart contracts](#smart-contracts)
- [Keeper service](#keeper-service)
- [Routes &amp; API](#routes--api)
- [Security &amp; audits](#security--audits)
- [Disclaimer](#disclaimer)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

EquiFlow lets a holder of tokenized US equities **unlock liquidity without selling**:

1. **Pledge** tokenized stocks (TSLA, AMZN, PLTR, NFLX, AMD) as collateral.
2. **Borrow** the over-collateralized USDG stablecoin against them, capped by each asset's loan-to-value.
3. **Repay** anytime to release collateral; positions that fall below the liquidation threshold can be liquidated by anyone for a bonus.

Prices come from **Pyth Network**, interest follows an Aave-style **kinked rate model**, and an optional **ERC-4337 smart wallet** bundles approval + borrow into a single sponsored-gas signature.

---

## Status

| | |
|---|---|
| **Network** | Robinhood Chain Testnet (Arbitrum Orbit L3, chainId `46630`, native ETH) |
| **Vault** | `0x86c4AC25524560799863505F7650B24014eDB0FB` |
| **Adapter registry** | `0xFF5f2Dea4b5DA49a40B317245f90d9c6c2a4519e` |
| **Interest rate model** | `0x2058Ee5fC42Db5FAD67dE2d3854DACd03041AA3F` (KinkedRateModel — scheduled; activates via `executeIrm()` after the 24 h owner timelock) |
| **Audit** | 7 rounds completed · 0 Critical · 0 High · 0 Medium open |
| **Tests** | 168 / 168 passing, 0 skipped (128 vault + 14 IRM + 6 adapter registry + 14 audit-batch + 6 market-hours) |

> Contract addresses are read from environment variables at runtime (`NEXT_PUBLIC_VAULT_ADDRESS`, …). The values above reflect the current testnet deployment; update them when you redeploy.

---

## Features

| Route | Description |
|---|---|
| `/markets` | Live markets with Pyth price feeds, search, sector tabs, sort, and an inline pledge sidebar |
| `/markets/[sym]` | Asset detail with price chart, risk parameters, and a pledge calculator |
| `/portfolio` | Position management — orbital atlas, health factor, and repay / borrow / withdraw modals |
| `/liquidations` | At-risk position board with a health-factor distribution and liquidation CTAs |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4 |
| Web3 | wagmi 3, viem 2, RainbowKit |
| Account abstraction | ERC-4337 v0.7 via Alchemy (Modular Account v2); EIP-7702 path implemented (UI-hidden) |
| Oracle | Pyth Network (Hermes pull model) via an on-chain `PythPriceAdapter` |
| Contracts | Solidity 0.8.24, Foundry (Forge) |
| Chain | Robinhood Chain Testnet — Arbitrum Orbit L3 (chainId `46630`) |
| Data / cache | Upstash Redis (optional — 24 h price history) |
| Hosting | Vercel (+ Vercel Cron for the keeper) |

---

## Architecture

### Oracle

- **Source**: Pyth Network. A `MockPyth` is used on RBN testnet (no Pyth deployment there yet); a real `IPyth` can be wired via `NEXT_PUBLIC_PYTH_ADDRESS` (e.g. `0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF` on Arbitrum Sepolia).
- **Keeper**: prices are pushed on-chain by the [keeper service](#keeper-service). A browser-side `usePriceKeeper` (active on the trading pages) `POST`s `{ symbol }` to `/api/keeper/tick` every 12 s; the server fetches the authoritative quote from Hermes, validates freshness + confidence, and signs `adapter.updatePrice(...)`. A Vercel Cron sweep (`/api/keeper/cron`) keeps the whole vault fresh server-side.
- **Deviation cap**: each update is capped at 5 % drift from the cached price. When the cache lags &gt; 30 min (fresh deploy / keeper outage) the keeper falls back to `forceUpdatePrice` so prices unstick instead of repeatedly reverting (audit H-02 fix).

### Interest rate

- **KinkedRateModel** (Aave V3 style): `base = 1 %`, `slope1 = +5 %` up to `U_optimal = 85 %`, `slope2 = +49 %` from 85 → 100 %. Borrow APR is hard-clamped at `MAX_BORROW_RATE_BPS = 50 %` regardless of utilisation.
- **Pluggable**: rotate the model via `scheduleIrm` / `executeIrm` (24 h timelock); emergency rescue via `forceClearIrm` (instant). See `docs/SECURITY_RUNBOOK.md`.
- **Frontend**: `useProtocolStats` reads `vault.borrowApyBps()` (which delegates through the active IRM) and derives LP / reserve APYs client-side in `lib/web3/irm.ts` — `borrowApy × U × (1 − reserveFactor)` and `borrowApy × U × reserveFactor`. The pure-TypeScript curve in `DEFAULT_RATE_CONFIG` mirrors the deployed parameters so SSR and pre-RPC renders match on-chain numbers.

### Account abstraction

- **Standard**: ERC-4337 v0.7 via Alchemy (Modular Account v2). An EIP-7702 same-address delegation path also exists in `lib/aa/` but is intentionally hidden from the wallet UI pending a future embedded-signer integration.
- **Opt-in**: the smart wallet is **off by default** — users enable it from the wallet menu ("Smart wallet"). The counterfactual address is computed client-side and the account is deployed on-chain on its first sponsored UserOp.
- **Batched UserOps**: in smart-wallet mode, `approve` + `pledgeAndBorrow` are bundled into a single signature. In plain EOA (e.g. MetaMask) mode they are necessarily two separate transactions ("Approve · step 1 of 2" → "Lock collateral · step 2 of 2").
- **Gas modes**: `sponsored` (project-funded paymaster) is the mode wired into every flow today. A `usdg` ERC-20-paymaster path is plumbed (type + policy) but not yet selectable from the UI; it requires `NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID_USDG`.

### Chain

- **Robinhood Chain Testnet** — Arbitrum Orbit L3 with native ETH, chainId `46630`.

---

## Getting started

### Prerequisites

- **Node.js** ≥ 20 and **pnpm** ≥ 9
- **Foundry** (`forge`, `cast`) — only for building/testing/deploying the contracts
- A wallet with Robinhood Chain Testnet ETH (see the in-app `/faucet`)

### Installation

```bash
pnpm install
cp .env.example .env.local
```

### Environment

Fill in `.env.local`. See `.env.example` for the full annotated list — the essentials:

| Variable | Required? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_RBN_RPC_URL` | ✅ | Robinhood Chain RPC endpoint |
| `NEXT_PUBLIC_VAULT_ADDRESS` | ✅ | Deployed `EquiFlowVault` address |
| `NEXT_PUBLIC_TOKEN_TSLA … _AMD` | ✅ | Tokenized-stock addresses (claim from `/faucet`) |
| `NEXT_PUBLIC_USDC_ADDRESS` | ▢ | USDG/USDC token (enables balance reads) |
| `NEXT_PUBLIC_PYTH_ADDRESS` | ▢ | On-chain Pyth contract (when MockPyth is replaced) |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | ▢ | Enables the smart wallet (AA). Without it, the app falls back to the EOA flow |
| `NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID` | ▢ | Sponsored-gas policy for UserOps |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | ▢ | WalletConnect / mobile-QR wallets |
| `KEEPER_PRIVATE_KEY` | ▢ | Server-side signer for the price keeper (testnet burner only) |
| `CRON_SECRET` + `NEXT_PUBLIC_CRON_SECRET` | ▢\* | Bearer auth for the keeper endpoints — **required** whenever `KEEPER_PRIVATE_KEY` is set |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN` | ▢ | Real 24 h price history / sparklines (optional) |

> **Legend:** ✅ required · ▢ optional · ▢\* required only when `KEEPER_PRIVATE_KEY` is set.

> ℹ️ The IRM and adapter-registry addresses are deploy outputs / on-chain reads — the frontend resolves the active IRM through `vault.irm()`, so they are **not** frontend env vars.

### Run

```bash
pnpm dev      # dev server at http://localhost:3000
pnpm build    # production build
pnpm start    # serve the production build
```

---

## Project structure

```
app/
├── app/                  ← Next.js App Router routes + API handlers (app/api/*)
├── components/           ← UI components (PledgeSidebar, WalletButton, modals, …)
├── lib/
│   ├── aa/               ← ERC-4337 / EIP-7702 smart-wallet layer
│   ├── hooks/            ← wagmi/react-query data hooks (protocol stats, positions, …)
│   ├── web3/             ← oracle, IRM mirror, Hermes, market-hours helpers
│   └── config/           ← chain, stocks, vault config
└── contracts/            ← Foundry project (Solidity sources, tests, deploy scripts)
```

---

## Smart contracts

```
contracts/src/
├── EquiFlowVault.sol              ← main vault (collateral, borrow, LP, liquidation)
├── VaultMath.sol                  ← external library (M-01 loops + _releaseAssetBorrows)
├── interest/
│   ├── IInterestRateModel.sol     ← pluggable IRM interface
│   └── KinkedRateModel.sol        ← Aave V3-style two-slope curve (immutable)
└── oracle/
    ├── PythPriceAdapter.sol       ← Chainlink-style wrapper around a Pyth feed
    └── PythAdapterRegistry.sol    ← canonical adapter-per-priceId directory (T-4 fix)
```

| Function | Description |
|---|---|
| `pledgeAndBorrow(token, amount, borrowUsd)` | Pledge collateral + draw USDG in one call |
| `repay(amountUsd)` / `repayMax()` | Partial or full debt repayment |
| `withdraw(token, amount)` | Withdraw free collateral |
| `register(amount)` / `withdrawLp(shares)` | LP deposit / withdraw (earn yield from borrower interest) |
| `liquidate(user, token, debtUsd)` | Liquidate unhealthy positions (5 % bonus, configurable) |
| `scheduleIrm` / `executeIrm` | Owner rotates the rate model via the 24 h timelock |
| `forceClearIrm` | Emergency rescue — instant fallback to legacy `borrowRateBps` (M-02 fix) |
| `scheduleWriteOffBadDebt` / `executeWriteOffBadDebt` | Socialise unrecoverable bad debt to LPs (24 h timelock) |

### Build, test, deploy

```bash
cd contracts

# Build (EIP-170 size budget: optimizer_runs=1, no metadata)
forge build

# Test suite (168 tests)
forge test --summary

# Deploy — Robinhood Chain testnet REQUIRES `--skip-simulation`; the RPC's
# strict intrinsic-gas check rejects forge's simulated estimates.
source .env
forge script script/Deploy.s.sol \
  --rpc-url $RBN_RPC_URL \
  --broadcast \
  --skip-simulation

# Activate the scheduled IRM (24 h after deploy)
cast send $VAULT_ADDRESS "executeIrm()" --rpc-url $RBN_RPC_URL --private-key $DEPLOYER_PK
```

`Deploy.s.sol` is end-to-end: Foundry auto-deploys and links the `VaultMath` library, then the script deploys `EquiFlowVault`, `PythAdapterRegistry`, five `PythPriceAdapter` instances (TSLA, AMZN, PLTR, NFLX, AMD) and `KinkedRateModel`, lists each asset on the vault, registers the adapters, and schedules the IRM swap. The optional `DeployWethVault.s.sol` adds a second vault that reads the same adapters through the registry — keeper push volume stays at one update per `priceId` regardless of vault count.

---

## Keeper service

The price keeper lives at `/api/keeper/tick` (browser-triggered, one symbol per call) and `/api/keeper/cron` (Vercel Cron / external scheduler, full sweep). Both require `Authorization: Bearer ${CRON_SECRET}` whenever `KEEPER_PRIVATE_KEY` is set (testnet exposes a matching `NEXT_PUBLIC_CRON_SECRET` for the browser tick — see `.env.example` for the production-hardening path).

Per tick:

1. Resolve the `adapter` from the vault's `assets(token)` mapping (allowlisted against `listedAssets()`, 60 s cache).
2. Fetch the authoritative Pyth quote from Hermes; reject stale / wide-confidence quotes.
3. Read `latestRoundData()` + `maxDeviationBps` from the adapter and compute the implied deviation from the new quote.
4. If deviation ≤ cap → `updatePrice`. If deviation &gt; cap **and** age ≥ 30 min → `forceUpdatePrice` (H-02 escape). Otherwise return `503 deviation_cooldown_active` so the client retries after the cooldown.
5. Sign with `KEEPER_PRIVATE_KEY` and submit. Best-effort: record the price into the 24 h Upstash set, then run the Auto-Defender sweep (currently `dry_run` until session-key bindings ship).

---

## Routes &amp; API

Beyond the core trading flow:

| Route | Purpose |
|---|---|
| `/faucet` | Claim testnet stock tokens &amp; USDG |
| `/governance` | Protocol governance &amp; rate-rotation log |
| `/audits` | Audit reports &amp; security posture |
| `/bug-bounty` | Bounty program scope &amp; history |
| `/api-reference` | Illustrative public REST + GraphQL API reference (markets, portfolio, liquidations, oracle/Pyth, account-abstraction groups) |
| `/sdk` | TypeScript SDK + viem call snippets |
| `/tokenomics` | USDG supply &amp; LP yield split |
| `/contracts` | Deployed addresses by network |
| `/docs` | Long-form protocol docs |

Internal Next.js API handlers live under `app/api/*` (`/api/markets/*`, `/api/pyth/*`, `/api/keeper/*`, `/api/defender/*`).

---

## Security &amp; audits

7 audit rounds completed — see `docs/SECURITY_RUNBOOK.md` for ops procedures and the `docs/SECURITY-AUDIT-*.md` series for per-pass findings. Headline:

| Severity | Original | Resolved | Open |
|---|---:|---:|---:|
| Critical | 0 | — | **0** |
| High | 2 (H-01, H-02) | 2 | **0** |
| Medium | 5 (M-01..M-05) | 5 | **0** |
| Low | 11 | 4 | 7 (defense-in-depth, no fund risk) |
| Informational | 17 | 7 | 10 (style + observability) |

Selected fixes: `Ownable2Step` on vault + adapter (L-01), 5 % per-update deviation cap with a `forceUpdatePrice` escape (H-02), 24 h timelocks on IRM swap / write-off / parameter widening, `PythAdapterRegistry` for cross-vault adapter sharing (T-4), and index-scale per-asset interest attribution (M-01).

### EIP-170 fit

After applying every audit fix, `EquiFlowVault` exceeded the 24 KiB contract-size ceiling. To fit, the build uses `optimizer_runs = 1` with metadata stripped, dedups the multi-collateral view loops into `_collateralStats()`, extracts `_releaseAssetBorrows` + the M-01 scaling loops into the external `VaultMath` library, and drops convenience views (`lpApyBps()` / `reserveApyBps()`) that the frontend now derives client-side. Result: the deployed bytecode fits under 24 KiB with all 168 tests passing.

---

## Disclaimer

EquiFlow is a **testnet demonstration** built for educational and portfolio purposes. It runs on Robinhood Chain Testnet, uses no real funds, and some on-screen figures (e.g. token-distribution charts) are explicitly labelled illustrative. Nothing in this repository or UI constitutes financial, investment, legal, or tax advice. Use at your own risk.

---

## Contributing

Issues and pull requests are welcome. Before opening a PR:

```bash
pnpm build              # app type-checks + builds
cd contracts && forge test   # contracts pass
```

Keep changes scoped, match the surrounding code style, and describe user-facing behavior in the PR.

---

## License

Released under the [MIT License](LICENSE).
