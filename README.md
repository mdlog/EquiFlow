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
# Fill in RPC, token addresses, vault address, keeper key

# 3. Run dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Smart Contracts

Core contract: **EquiFlowVault.sol** (`contracts/src/`)

| Function | Description |
|---|---|
| `pledgeAndBorrow(token, amount, borrowUsd)` | Pledge collateral + draw USDG in one call |
| `repay(amountUsd)` / `repayMax()` | Partial or full debt repayment |
| `withdraw(token, amount)` | Withdraw free collateral |
| `register(amount)` / `withdrawLp(shares)` | LP deposit/withdraw (earn yield from borrower interest) |
| `liquidate(user, token, debtUsd)` | Liquidate unhealthy positions |

```bash
# Deploy contracts
cd contracts
forge build && forge test
forge script script/Deploy.s.sol --rpc-url $RBN_RPC_URL --broadcast --private-key $PK
```

---

## Architecture

- **Oracle**: Pyth Network (MockPyth on testnet) — browser keeper fetches Hermes prices and pushes on-chain via `/api/keeper/tick`
- **Interest Rate**: Kinked two-slope IRM (Aave V3 style) — `R_base` 1%, `R_slope1` 5%, `R_slope2` 49%, `U_optimal` 85%. Borrow APR is hard-clamped at `MAX_BORROW_RATE_BPS = 50%` regardless of utilisation. Rotate via `scheduleIrm` / `executeIrm` (see `docs/SECURITY_RUNBOOK.md` §7).
- **Account Abstraction**: ERC-4337 v0.7 + EIP-7702 via Alchemy — smart wallets, gas sponsorship, batched UserOps. Gas modes: `sponsored` (default, project-funded) and `usdg` (ERC20 paymaster).
- **Chain**: Robinhood Chain Testnet (chainId `46630`, Arbitrum Orbit L3)

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
