<p align="center">
  <img src="public/logo-equiflow.png" alt="EquiFlow" width="120" />
</p>

<h1 align="center">EquiFlow</h1>

<p align="center">
  <strong>Yield-generating stock collateralization on Robinhood Chain (Arbitrum L3).</strong>
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
  <img src="https://img.shields.io/badge/Alchemy-AA-0C43FF?logo=alchemy&logoColor=white" alt="Alchemy" />
  <img src="https://img.shields.io/badge/audit-7%20passes-success" alt="audit pass count" />
  <img src="https://img.shields.io/badge/tests-148%20passing-brightgreen" alt="test count" />
</p>

---

Pledge tokenized US equities as collateral, borrow regulated stablecoins (USDG), and route the proceeds into yield — without selling a share. One signature, sponsored gas, no taxable sale.

---

## Status

| | |
|---|---|
| **Network** | Robinhood Chain Testnet (Arbitrum Orbit L3, chainId `46630`) |
| **Vault** | `0xbaB08584Ce7a240BC1Fc641BC6A5682067c5b2fC` |
| **Audit** | 7 rounds completed · 0 Critical · 0 High · 0 Medium open |
| **Tests** | 148 / 148 passing (123 vault + 14 IRM + 6 adapter registry, +5 N-8 deferred) |
| **IRM** | KinkedRateModel scheduled (active after 24 h owner timelock via `executeIrm()`) |

---

## Features

| Route | Description |
|---|---|
| `/markets` | Live markets with Pyth price feeds, search/filter, sector tabs, and inline pledge sidebar |
| `/markets/[sym]` | Asset detail with OHLCV chart, risk parameters, and pledge calculator |
| `/portfolio` | Position management — orbital atlas, health factor, repay/borrow/withdraw modals |
| `/liquidations` | At-risk position board with health factor leaderboard and liquidation CTAs |

---

## Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Fill in:
#   NEXT_PUBLIC_RBN_RPC_URL, NEXT_PUBLIC_VAULT_ADDRESS, NEXT_PUBLIC_IRM_ADDRESS,
#   NEXT_PUBLIC_ADAPTER_REGISTRY, NEXT_PUBLIC_USDC_ADDRESS, NEXT_PUBLIC_PYTH_ADDRESS,
#   NEXT_PUBLIC_TOKEN_TSLA … TOKEN_AMD,
#   KEEPER_PRIVATE_KEY (server-side signer), CRON_SECRET + NEXT_PUBLIC_CRON_SECRET
#     (matching pair so the browser tick can authenticate to /api/keeper/tick)

# 3. Run dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Smart Contracts

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
| `register(amount)` / `withdrawLp(shares)` | LP deposit/withdraw (earn yield from borrower interest) |
| `liquidate(user, token, debtUsd)` | Liquidate unhealthy positions (5% bonus, configurable) |
| `scheduleIrm` / `executeIrm` | Owner rotates rate model via 24 h timelock |
| `forceClearIrm` | Emergency rescue — instant fallback to legacy `borrowRateBps` (M-02 audit fix) |
| `scheduleWriteOffBadDebt` / `executeWriteOffBadDebt` | Socialise unrecoverable bad debt to LPs (24 h timelock) |

### Build, test, deploy

```bash
cd contracts

# Build (with EIP-170 size budget: optimizer_runs=1, no metadata)
forge build

# 148-test suite
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

`Deploy.s.sol` is end-to-end: it deploys `VaultMath` library, `EquiFlowVault`, `PythAdapterRegistry`, five `PythPriceAdapter` instances (TSLA, AMZN, PLTR, NFLX, AMD), `KinkedRateModel`, lists each asset on the vault, registers adapters in the registry, and schedules the IRM swap. The optional `DeployWethVault.s.sol` adds a second vault that reads the same adapters via the registry — keeper push volume stays at one per `priceId` regardless of vault count.

---

## Architecture

### Oracle

- **Source**: Pyth Network. MockPyth on RBN testnet (no Pyth deployment there yet), real Pyth via `PYTH_ADDRESS=0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF` on Arbitrum Sepolia.
- **Browser keeper**: `usePriceKeeper` (mounted at `/markets`, `/portfolio`, `/liquidations`) POSTs `{ symbol }` to `/api/keeper/tick` every 12 s. The server fetches the authoritative quote from Hermes, validates freshness + confidence, and signs `adapter.updatePrice([encodedBytes])`.
- **Deviation cap**: each update is capped at 5 % drift from cache. When the cache lags > 30 min (e.g. fresh deploy, keeper outage) the keeper transparently falls back to `forceUpdatePrice` so prices unstick instead of repeating reverts (audit H-02 fix).

### Interest rate

- **KinkedRateModel** (Aave V3 style): `base = 1 %`, `slope1 = +5 %` up to `U_optimal = 85 %`, `slope2 = +49 %` from 85 → 100 %. Borrow APR is hard-clamped at `MAX_BORROW_RATE_BPS = 50 %` regardless of utilisation.
- **Pluggable**: rotate via `scheduleIrm` / `executeIrm` (24 h timelock). Emergency rescue: `forceClearIrm` (instant). See `docs/SECURITY_RUNBOOK.md` §7.
- **Frontend integration**: `useProtocolStats` reads `vault.borrowApyBps()` (which delegates through the active IRM) and derives LP/reserve APYs client-side via `lib/web3/irm.ts` — `(borrowApy × U × (1 − reserveFactor))` and `(borrowApy × U × reserveFactor)`. The pure-TypeScript curve in `lib/web3/irm.ts::DEFAULT_RATE_CONFIG` mirrors the deployed parameters so SSR and pre-RPC renders show the same number.

### Account abstraction

- **Standards**: ERC-4337 v0.7 + EIP-7702 via Alchemy.
- **Gas modes**: `sponsored` (project-funded paymaster) and `usdg` (ERC-20 paymaster, optional).
- **UX**: smart wallet auto-creates on first interaction; batched UserOps for two-step flows (approve + pledgeAndBorrow).

### Chain

- **Robinhood Chain Testnet** (chainId `46630`, Arbitrum Orbit L3 with native ETH).

---

## Security

7 audit rounds completed — see `docs/SECURITY_RUNBOOK.md` for ops procedures, and the report series (`docs/SECURITY-AUDIT-*.md`) for the per-pass finding log. Headline:

| Severity | Original | Resolved | Open |
|---|---:|---:|---:|
| Critical | 0 | — | **0** |
| High | 2 (H-01, H-02) | 2 | **0** |
| Medium | 5 (M-01..M-05) | 5 | **0** |
| Low | 11 | 4 | 7 (defense-in-depth, no fund risk) |
| Informational | 17 | 7 | 10 (style + observability) |

### Fixes deployed (by audit pass)

- **Pass 1-2**: H-01 strict-equality on `register()`, H-02 `forceUpdatePrice` escape hatch with 30 min cooldown, M-02 IRM multi-point probe + `forceClearIrm` rescue, M-05 24 h timelock on `writeOffBadDebt`.
- **Pass 3**: N-1 `IRM_CALL_GAS_LIMIT = 100k`, N-3 dust-threshold on `executeWriteOffBadDebt`, N-6 `MIN_CLOSE_FACTOR_BPS = 10 %`, N-7 timelock on reserve factor / liquidation bonus / borrow cap widening.
- **Pass 3 follow-up**: T-1 `MIN_LIQUIDATION_BONUS_BPS = 1 %`, T-2 cancel-event payloads, T-3 distinct `IrmForceCleared` event.
- **Pass 4**: L-01 `Ownable2Step` on both vault and adapter, M-04 `LiquidationDust` revert when liquidator pays 0 USDG, Q-1 `uint256` confidence-ratio computation.
- **Pass 5**: M-01 index-scale per-asset attribution (so `borrowCapUsd` reflects accrued interest, not just principal), T-4 `PythAdapterRegistry` for cross-vault adapter sharing.
- **Pass 6**: M-03 `confidenceUpdatedAt()` interface + defense-in-depth freshness check, N-8 `delistAsset` (deferred to v2 — see EIP-170 note below).

### EIP-170 fit

After applying every audit fix, `EquiFlowVault` reached 26,109 bytes — 1,533 over the 24 KiB contract-size ceiling. The deploy script was rejected at chain level. Fit-and-broadcast applied:

- `optimizer_runs = 1`, strip metadata (`bytecode_hash = none`, `cbor_metadata = false`).
- Dedup the three multi-collateral view loops into a single `_collateralStats()` helper.
- Extract `_releaseAssetBorrows` plus the two M-01 scaling loops into the external `VaultMath` library (Foundry handles deployment + linkage in the same script).
- Drop convenience views `lpApyBps()` / `reserveApyBps()` — frontend derives them via `computeSupplyRateBps` in `lib/web3/irm.ts`.
- Hoist `_lastContributorIndex` out of the inner attribution loop.
- Defer `delistAsset` (N-8) until the next refactor frees more budget.

Result: 24,493 bytes deployed (+82 byte margin), all 148 tests still pass.

---

## Keeper service

The price keeper lives at `/api/keeper/tick` (browser-triggered, one symbol per call) and `/api/keeper/cron` (Vercel Cron / external scheduler, full sweep). Both require `Authorization: Bearer ${CRON_SECRET}` when `KEEPER_PRIVATE_KEY` is set (testnet exposes the matching `NEXT_PUBLIC_CRON_SECRET` for the browser tick — see `.env.example` for the production hardening path).

Per tick:

1. Resolve `adapter` from the vault's `assets(token)` mapping (allowlisted against `listedAssets()` — cache TTL 60 s).
2. Fetch the authoritative Pyth quote from Hermes. Reject stale / wide-confidence quotes.
3. Read `latestRoundData()` + `maxDeviationBps` from the adapter. Compute the implied deviation between cached price and the new Pyth quote.
4. If deviation ≤ cap → `updatePrice`. If deviation > cap **and** age ≥ 30 min → `forceUpdatePrice` (H-02 audit escape). Otherwise return 503 `deviation_cooldown_active` so the client retries after the cooldown elapses.
5. Sign via `KEEPER_PRIVATE_KEY` and submit. Best-effort: record price to the 24 h Upstash sorted set, run the Auto-Defender sweep (currently `dry_run` until session-key bindings ship).

---

## Other routes

These routes ship with the app but aren't part of the primary trading flow:

| Route | Purpose |
|---|---|
| `/faucet` | Claim testnet stock tokens & USDG |
| `/governance` | Protocol governance & rate-rotation log |
| `/audits` | Audit reports, security posture |
| `/bug-bounty` | Bounty program scope & history |
| `/api-reference` | Public REST surface (`/api/markets/*`, `/api/pyth/*`) |
| `/sdk` | TypeScript SDK + viem call snippets |
| `/tokenomics` | USDG supply, LP yield split |
| `/contracts` | Deployed addresses by network |
| `/docs` | Long-form protocol docs |

---

## License

MIT
