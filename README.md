<p align="center">
  <img src="logo-equiflow.png" alt="EquiFlow" width="120" />
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
  <img src="https://img.shields.io/badge/Solidity-0.8-363636?logo=solidity&logoColor=white" alt="Solidity" />
  <img src="https://img.shields.io/badge/Foundry-Forge-DEA584?logo=ethereum&logoColor=white" alt="Foundry" />
  <img src="https://img.shields.io/badge/Arbitrum-Orbit_L3-28A0F0?logo=arbitrum&logoColor=white" alt="Arbitrum" />
  <img src="https://img.shields.io/badge/Pyth-Network-7B61FF?logo=pyth&logoColor=white" alt="Pyth" />
  <img src="https://img.shields.io/badge/ERC--4337-Account_Abstraction-FF6B00?logo=ethereum&logoColor=white" alt="ERC-4337" />
  <img src="https://img.shields.io/badge/wagmi-3-1C1C1C?logo=wagmi&logoColor=white" alt="wagmi" />
  <img src="https://img.shields.io/badge/viem-2-FFC517?logoColor=black" alt="viem" />
  <img src="https://img.shields.io/badge/Alchemy-AA-0C43FF?logo=alchemy&logoColor=white" alt="Alchemy" />
</p>

---

Pledge tokenized US equities as collateral, borrow regulated stablecoins (USDG), and route the proceeds into yield — without selling a share. One signature, sponsored gas, no taxable sale.

---

## Stack

| Layer | Library |
|---|---|
| Framework | **Next.js 16.2.6** (App Router, React 19.2) |
| Styling | **Tailwind CSS v4** (`@theme inline` design tokens in `app/globals.css`) |
| Wallet | **wagmi 3 + viem 2** (injected / MetaMask / Coinbase) + **smart wallets** (Modular Account v2 + EIP-7702 via Alchemy) |
| Data | **@tanstack/react-query 5** (provider in `app/providers.tsx`) |
| Fonts | Source Serif 4, Geist, JetBrains Mono via `next/font/google` |
| Chain | **Robinhood Chain Testnet** (chainId `46630`, settled on Arbitrum) |
| Oracles | **Pyth Network** — MockPyth on RBN + Hermes proxy + session-aware feeds (regular / pre / post / overnight) |
| AA stack | **ERC-4337 v0.7** via `permissionless` + viem bundler client. Alchemy Rundler + Gas Manager paymaster (native or USDG ERC20). EIP-7702 lets existing MetaMask EOAs upgrade in place. See `lib/aa/`. |
| Keeper | Server-side burner wallet at `/api/keeper/tick` signs `adapter.updatePrice()`. Also runs Auto-Defender — repays opted-in positions via session-key UserOps when HF drops below user threshold. |

> ⚠ Next.js 16 has breaking changes from prior versions — see local docs at `node_modules/next/dist/docs/` before editing internals.

---

## Pages

All pages share a max content width of **1320px**, a sticky `PageNav`, an `OracleMarquee` live ticker, and a shared `SiteFooter` (with a 40 px paper buffer for clean separation from content above).

| Route | Purpose | Highlights |
|---|---|---|
| `/` | Landing | Hero with live demo card (collateral → borrow → yield), 5-stat band, 3-motion how-it-works, supported assets table, 4 product surfaces, integrations row (Pyth · Aave · ERC-4337 · Arbitrum · OpenZeppelin), dark final CTA, deep footer. |
| `/markets` | Living Ledger | 8-column markets table with breathing-per-volatility rows, live Pyth price ticks (green/red flash), `SessionBadge` (regular/pre/post/overnight), sparklines, LTV bars, per-asset pledge button, KPI stat-band footer. Switches "Liquidity" → "Your balance" when wallet connected. Each row click navigates to `/markets/[sym]`. |
| `/markets/[sym]` | Asset detail | Hero (logo / symbol / name / address / live price / 24h pill / session) → 5-cell KPI strip → **real Pyth Benchmarks price chart** with 1D/7D/30D toggle and crosshair → risk parameters table + pledge calculator side-by-side → primary pledge CTA. Renders a dedicated `not-found.tsx` for unknown tickers. |
| `/topography` | Yield Topography | KPI strip (best vault yield, avg vault APR, avg borrow APR, total liquidity, markets online), full-width terrain SVG (peaks ∝ vault APR / borrow APR / max LTV via toggle), sortable markets table + sticky asset deep-dive panel (30-day APR sparkline + risk parameters + pledge calculator + session badge). |
| `/pledge` | The Bundle | **Left**: composer (asset picker / collateral input / borrow slider / auto-vault toggle / health summary / sign CTA) with full **wagmi** flow (balance / allowance / approve / pledge-and-borrow / receipt tracking). **Right**: tx-summary banner → bundle stage animation → 2×2 detail grid (liquidation risk chart, oracle attestations, fee breakdown, recent activity). Faucet link + chain switch built-in. |
| `/positions` | Position Atlas | Position selector + 5-KPI banner (collateral · debt · equity · health · P&L), **orbital atlas SVG** (collateral bodies orbiting a USDG core with liquidation arc), collateral table + debt panel, 35-day performance chart, **6 wagmi-wired action modals**: `RepayDebtModal`, `BorrowMoreModal`, `WithdrawCollateralModal`, plus `LpDepositModal` / `LpWithdrawModal` for LP shares. Oracle activity log + position tx history. |
| `/liquidations` | At-risk board | Protocol-wide leaderboard of positions sorted by health factor. KPI banner (active borrowers · liquidatable count · debt at risk · bonus pool). Sections for liquidatable (HF < 1) · watch (HF 1–1.25) · healthy. Each row shows HF bar (red/amber/green) + Liquidate CTA opening `LiquidateModal` (approve USDG → `vault.liquidate(user, token, debtUsd)`). Borrower discovery via `Pledged` event scan (~24h window). |

---

## Project structure

```
app/
├─ app/
│  ├─ page.tsx              # Landing
│  ├─ layout.tsx            # Root layout · fonts · <Providers>
│  ├─ providers.tsx         # WagmiProvider + QueryClientProvider + <PriceKeeperMount/>
│  ├─ globals.css           # Tailwind v4 + design tokens (paper / ink / up / down / amber)
│  ├─ markets/
│  │  ├─ page.tsx              # Living Ledger table (rows link to /markets/[sym])
│  │  └─ [sym]/
│  │     ├─ page.tsx           # Server entry · validates symbol → 404
│  │     ├─ AssetDetailClient.tsx  # Hero + KPIs + chart + risk + pledge calc
│  │     └─ not-found.tsx      # 404 surface with suggested tickers
│  ├─ topography/page.tsx
│  ├─ pledge/
│  │  ├─ page.tsx           # Suspense wrapper
│  │  └─ PledgeClient.tsx   # Composer + bundle stage + detail panels (wagmi)
│  ├─ positions/page.tsx    # Atlas + 5 wagmi-wired action modals
│  ├─ liquidations/page.tsx # At-risk board · LiquidateModal trigger
│  └─ api/
│     ├─ keeper/tick/       # POST → server signs adapter.updatePrice() with KEEPER_PRIVATE_KEY
│     │                     #        (also appends price to Upstash 24h sorted set)
│     ├─ markets/
│     │  ├─ 24h/            # GET ?syms=… → Hermes latest + Pyth Benchmarks anchor
│     │  ├─ sparkline/      # GET ?syms=…&points=N → Upstash sorted-set downsample
│     │  └─ history/[sym]/  # GET ?days=N&resolution=… → Pyth Benchmarks OHLCV bars
│     └─ pyth/
│        ├─ [priceId]/      # GET → proxy to Pyth Hermes by priceId
│        └─ by-symbol/[sym] # GET → proxy by ticker (auto-resolves active session)
├─ components/
│  ├─ PageNav.tsx               # Sticky nav with brand + page tabs + WalletButton
│  ├─ SiteFooter.tsx            # Shared deep footer (gap prop for landing exception)
│  ├─ WalletButton.tsx          # Connect / chain-switch / balance / disconnect dropdown
│  ├─ ChainTicker.tsx           # RBN chain dot + live block number
│  ├─ OracleMarquee.tsx         # Auto-scrolling stock ticker strip
│  ├─ OraclePing.tsx            # Breathing dot indicator
│  ├─ SessionBadge.tsx          # Pyth session label (regular / pre / post / overnight)
│  ├─ Sparkline.tsx
│  ├─ StockBalanceCell.tsx      # Live on-chain balance per asset
│  ├─ SectionHead.tsx
│  ├─ AssetLogo.tsx
│  ├─ Wordmark.tsx
│  ├─ PriceKeeperMount.tsx      # Mounted in providers · drives the in-browser keeper loop
│  ├─ RepayDebtModal.tsx        # Repay (partial / max) · approve + repay flow
│  ├─ BorrowMoreModal.tsx       # Draw more debt against existing collateral
│  ├─ WithdrawCollateralModal.tsx
│  ├─ LpDepositModal.tsx        # register(amount) · USDG → vault LP shares
│  ├─ LpWithdrawModal.tsx       # withdrawLp(shares) · share-priced redemption
│  ├─ AssetPriceChart.tsx       # Real OHLCV chart with 1D/7D/30D toggle (used by /markets/[sym])
│  ├─ LiquidateModal.tsx        # Approve USDG → vault.liquidate(user, token, debtUsd)
│  └─ AssetActivityFeed.tsx     # On-chain Pledged + Liquidated event feed per asset
├─ lib/
│  ├─ chain.ts                  # Robinhood Chain Testnet definition + faucet URL
│  ├─ wagmi.ts                  # createConfig with injected/MetaMask/Coinbase connectors
│  ├─ contracts.ts              # ERC20_ABI, EQUIFLOW_VAULT_ABI (v2 w/ LP + reserves), env addresses, explorer helpers
│  ├─ stocks.ts                 # STOCKS catalogue (price / LTV / APRs / volatility / liveOnRBN)
│  ├─ pyth.ts                   # Pyth priceIds (by session) + MockPyth payload encoder + adapter ABI
│  ├─ format.ts                 # USD / pct / abbreviated number helpers
│  ├─ use-live-tick.ts          # Synthetic price-tick animation hook
│  ├─ use-position.ts           # On-chain composite position reader
│  ├─ use-stock-balance.ts      # Wallet stock-token balance hook
│  ├─ use-adapter-price.ts      # Reads cached price from PythAdapter on RBN
│  ├─ use-asset-configs.ts      # vault.assets(token) per listed asset (LTV / liq / staleness)
│  ├─ use-price-keeper.ts       # Browser loop · fetches Hermes → POSTs /api/keeper/tick
│  ├─ use-protocol-stats.ts     # TVL / utilization / borrow APY / LP APY / reserves
│  ├─ use-session-info.ts       # Resolves current market session per symbol
│  ├─ use-market-history.ts     # 24h changePct (Hermes) + sparkline (Upstash) hooks for /markets
│  ├─ use-asset-history.ts      # OHLCV history hook for /markets/[sym] chart (Pyth Benchmarks)
│  ├─ use-asset-activity.ts     # Pledged + Liquidated event scan per token (for activity feed)
│  ├─ use-at-risk-positions.ts  # Borrower discovery + sorted HF list (for /liquidations)
│  ├─ irm.ts                    # Kinked two-slope IRM (Aave V3 style) — pure utility, no I/O
│  ├─ price-history.ts          # Server-only · Upstash REST wrapper (sorted-set per ticker)
│  └─ use-push-mock-price.ts    # Manual push helper (debug)
├─ public/                  # Logo + default Next.js assets
├─ .env.example             # Env vars (RPC, token addresses, vault, USDC, KEEPER_PRIVATE_KEY)
└─ package.json
```

Smart contracts (separate workspace, Foundry):

```
../contracts/
├─ src/
│  ├─ EquiFlowVault.sol     # Core: pledgeAndBorrow / repay / withdraw / liquidate
│  │                        # v2: LP register / withdrawLp / pokeInterest / reserveFactor / treasury
│  ├─ mocks/                # MockERC20, MockPyth for testing
│  └─ oracle/               # PythAdapter (caches Pyth PriceFeed reads)
├─ script/                  # Deploy / setup scripts
├─ test/                    # Forge tests
└─ foundry.toml
```

---

## Getting started

### 1. Install

```bash
pnpm install
```

### 2. Configure env

```bash
cp .env.example .env.local
```

Fill in the addresses you control. The frontend gracefully degrades:
- **Without** `NEXT_PUBLIC_VAULT_ADDRESS` → pledge flow rehearses approve + transfer against a burn address (tokens are unrecoverable — testnet only).
- **With** vault address + at least one `NEXT_PUBLIC_TOKEN_*` → real on-chain pledge / borrow / repay / LP flow via wagmi.
- **Without** `KEEPER_PRIVATE_KEY` → `/api/keeper/tick` returns 500 and prices stay at last-cached value.
- **Without** wallet connected → `/positions` shows demo data for position #017.

```bash
# Chain
NEXT_PUBLIC_RBN_RPC_URL=https://rpc.testnet.chain.robinhood.com

# Faucet-issued stock tokens (claim from https://faucet.testnet.chain.robinhood.com/)
NEXT_PUBLIC_TOKEN_TSLA=0x...
NEXT_PUBLIC_TOKEN_AMZN=0x...
NEXT_PUBLIC_TOKEN_PLTR=0x...
NEXT_PUBLIC_TOKEN_NFLX=0x...
NEXT_PUBLIC_TOKEN_AMD=0x...
# AAPL / NVDA / SPY → reference only on testnet; deploy your own if needed
NEXT_PUBLIC_TOKEN_AAPL=
NEXT_PUBLIC_TOKEN_NVDA=
NEXT_PUBLIC_TOKEN_SPY=

# Protocol contracts (deploy from ../contracts/, then paste)
NEXT_PUBLIC_VAULT_ADDRESS=0x...   # EquiFlowVault on Robinhood Chain Testnet
NEXT_PUBLIC_USDC_ADDRESS=0x...    # Borrow / LP-share asset (USDG on testnet)

# Server-only secrets (NO NEXT_PUBLIC_ prefix) — burner keeper signer
# Funds adapter.updatePrice() ticks from /api/keeper/tick. Bundle exclusion is
# enforced by the missing NEXT_PUBLIC_ — never rename this var.
KEEPER_PRIVATE_KEY=

# Upstash Redis (optional) — backs the 24h price-history sorted set.
# When unset, /markets sparkline silently falls back to the seeded synthetic
# curve; the changePct number still works because it queries Hermes directly.
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

### 3. Run the dev server

```bash
pnpm dev
```

Open <http://localhost:3000>.

### 4. Production build

```bash
pnpm build
pnpm start
```

---

## Smart contracts

The frontend talks to **EquiFlowVault.sol** (see `../contracts/src/`). Key external entrypoints used by the app:

| ABI function | Used by | Notes |
|---|---|---|
| `pledgeAndBorrow(token, amount, borrowUsd)` | `/pledge` | One-call pledge + draw. `borrowUsd` is 1e18 internal USD units. |
| `repay(amountUsd)` / `repayMax()` | `RepayDebtModal` | Partial or full settle; UI auto-approves USDG first. |
| `withdraw(token, amount)` | `WithdrawCollateralModal` | Pull free (un-pledged) collateral back to wallet. |
| `register(amount)` / `withdrawLp(shares)` | `LpDepositModal` / `LpWithdrawModal` | USDG ⇄ vault LP shares — yield from borrower interest. |
| `pokeInterest()` | Keeper / on-demand | Materializes accrued interest into reserves. |
| `positionOf(user)` → `(collateralUsd, borrowedUsd, health)` | `usePosition` hook | Composite read for the atlas / KPI banner. |
| `collateral(user, token)`, `listedAssets()` | `usePosition` | Per-asset collateral breakdown used by orbit + collateral table. |
| `healthFactor(user)`, `isHealthy(user)`, `ltvCapBps(user)`, `liquidationThresholdBps(user)`, `maxBorrow(user)` | `/positions` | Real-time risk surface. |
| `totalAssetsUsd()`, `sharePriceUsd()`, `utilizationBps()`, `borrowApyBps()`, `lpApyBps()`, `lpPositionOf(lp)` | `useProtocolStats` | LP metrics for `/topography` + LP modals. |
| `assets(token)` | `useAssetConfigs` | Per-asset LTV / liq threshold / staleness / enabled flag. |

Deploy locally (from `../contracts/`):

```bash
forge build
forge test
forge script script/Deploy.s.sol --rpc-url $NEXT_PUBLIC_RBN_RPC_URL --broadcast --private-key $PK
```

Copy the deployed addresses into `app/.env.local`.

---

## Oracle pipeline

RBN does not host the real Pyth contract, so the protocol pairs a **MockPyth** instance with **PythAdapter** caches. Live prices arrive via this loop:

1. Browser `usePriceKeeper` ticks every few seconds while a tab is open.
2. It fetches the freshest session price from `/api/pyth/by-symbol/[sym]` (which proxies Pyth Hermes).
3. It POSTs `{adapter, priceId, pythPrice, pythExpo, fallbackPrice, volatility}` to `/api/keeper/tick`.
4. The server signs `adapter.updatePrice(...)` with `KEEPER_PRIVATE_KEY` and returns the tx hash.
5. Vault reads (`positionOf`, `healthFactor`, etc.) consume the cached value via the adapter.

US equities run on four Pyth session feeds — `regular`, `pre`, `post`, `overnight`. Each ticker advertises its current session via `useSessionInfo`, surfaced in the UI by `<SessionBadge/>`. Because MockPyth skips Wormhole signature verification, the keeper substitutes whichever session is freshest into the adapter's registered (regular) priceId. On a mainnet Pyth deployment this trick is replaced by one adapter per session + a router contract.

---

## 24h history pipeline (`/markets`)

The 24h change column and per-row sparkline are sourced from two complementary backends:

| Data | Source | Endpoint | Cache | Fallback when missing |
|---|---|---|---|---|
| `now` (current price) | Pyth Hermes `/v2/updates/price/latest` (batched) | `/api/markets/24h?syms=…` | `s-maxage=60` | `STOCKS.price` (static) |
| `then` (anchor 24h ago) | Pyth Benchmarks `/v1/shims/tradingview/history` per symbol, ±12h window, closest bar to `now − 86400` | same | same | `null` → row falls back to `STOCKS.changePct` |
| Sparkline (24 points / 24h) | Upstash Redis sorted set `px:<SYM>` appended by `/api/keeper/tick` | `/api/markets/sparkline?syms=…&points=24` | `s-maxage=15` | Seeded synthetic curve (existing behavior) |

> **Why Benchmarks, not Hermes, for `then`:** Pyth Hermes is designed for real-time updates — its historical endpoint `/v2/updates/price/{publish_time}` has thin and inconsistent retention for equity feeds (returns 404 / empty for most off-hours timestamps). Pyth Benchmarks is the official OHLCV service (same data source as the TradingView charts on pyth.network) and serves the regular-session bar that brackets `t-24h`. The `±12h` window guarantees we land inside the previous trading session even when `t-24h` falls into overnight/weekend.

The keeper records its own price each successful `adapter.updatePrice()` call (see `recordPrice()` in `lib/price-history.ts`), so the sorted set grows organically as long as a tab is open — no separate cron required. Entries older than ~24h are trimmed in the same pipeline as the insert.

If Upstash env vars are missing the sparkline endpoint short-circuits with `{ enabled: false }` and the frontend silently uses the seeded curve — the deployment still works end-to-end without a Redis dependency.

---

## Interest rate model (IRM)

Borrow and supply rates are **derived client-side** from on-chain utilization via the kinked two-slope formula used by Aave V3 — same shape, single pool. Implementation lives in `lib/irm.ts`; values flow through `useProtocolStats` and surface in `/markets`, `/markets/[sym]`, and `/topography`.

```
R_borrow(U) =
    R_base + (U / U_opt)              × R_slope1     when U ≤ U_opt
    R_base + R_slope1 + (U − U_opt) / (1 − U_opt) × R_slope2     when U > U_opt

R_supply(U) = R_borrow × U × (1 − reserveFactor)
```

Default config (`DEFAULT_RATE_CONFIG` in `lib/irm.ts`):

| Param | Value | Notes |
|---|---|---|
| `R_base` | 1 % | Supplier floor at idle |
| `R_slope1` | 5 % | Linear growth to optimal |
| `R_slope2` | 70 % | Steep penalty after optimal — kicks borrowers out |
| `U_optimal` | 85 % | Lower than Aave USDC (92 %) — volatile collateral needs more headroom |
| `reserveFactorBps` | live from `vault.reserveFactorBps()` (fallback 15 %) | Treasury take |

Why client-side: the vault's `setBorrowRateBps()` is currently owner-set storage. Once `pokeInterest()` is taught to call `_computeBorrowRateBps(utilization)` on-chain, the displayed numbers will match what suppliers actually accrue without any frontend change — `useProtocolStats` will still feed the same `derived` field, just sourced from `borrowApyBps()` directly.

> **UX note:** every row in `/markets` and `/topography` shows the **same** Borrow APR / Vault APR because the vault is single-pool USDG. Per-row badges read `protocol` (not the static per-asset numbers from `lib/stocks.ts`). Per-asset risk differentiation lives in **LTV** and **liquidation threshold**, both of which are real on-chain via `vault.assets(token)`.

---

## Design system

Defined in [app/globals.css](app/globals.css) as Tailwind v4 `@theme inline` tokens:

| Token | Color | Use |
|---|---|---|
| `--paper` | `#FAF8F2` | Page background |
| `--paper-alt` | `#F3EFE5` | Card / stat-band background |
| `--paper-deep` | `#ECE5D2` | LTV bar fill, deeper accents |
| `--ink` | `#1A1814` | Primary text, primary buttons |
| `--ink-soft`, `--ink-mute` | tonal | Secondary / tertiary text |
| `--hairline`, `--hairline-soft` | `#D9D2C2`, `#EAE4D5` | Dividers |
| `--up` / `--up-soft` | oklch greens | Gains, vault APR, healthy state |
| `--down` / `--down-soft` | oklch reds | Losses, liquidation risk |
| `--amber` / `--amber-soft` | oklch oranges | Warnings, gas badges |
| `--brand` | oklch blue | Reserved |

Animations (`@keyframes ef-*`): `ef-breathe` (oracle pulse), `ef-pulse` (liquidation ring), `ef-tick-up` / `ef-tick-down` (price flash), `ef-marquee` (ticker scroll), `ef-spin` (loading), `ef-fade-in`.

Reference HTML/JSX prototypes live in `../desain/` — used as the visual source of truth for each page port.

---

## Conventions

- **No `min-h-screen` + `overflow-hidden` on grid sections** — pages scroll naturally so `SiteFooter` is reachable.
- **`max-w-[1320px] mx-auto px-8`** is the canonical content container, applied inside (not around) sticky headers and full-width band backgrounds.
- **Real wagmi state is preserved** in `/pledge` and `/positions`. UI ports adapt design markup around the existing hooks rather than replacing them.
- **`<SiteFooter />`** = default (paper buffer above). Use `<SiteFooter gap={false} />` only when the section directly above is `bg-ink` (landing's `FinalCta`) where the contrast itself separates them.
- **Server secrets must never wear `NEXT_PUBLIC_`.** Next.js inlines any `NEXT_PUBLIC_*` literal into the client bundle — that is how `KEEPER_PRIVATE_KEY` leaked previously. `process.env[k]` with a computed key also breaks: it stays `undefined` on the client and causes hydration mismatches. Always write the key as a static literal.
