# EquiFlow contracts

Solidity sources, Foundry test suite, and deploy scripts for the EquiFlow lending vault on Robinhood Chain (Arbitrum Orbit L3).

```
src/
├── EquiFlowVault.sol              ← main vault: collateral, borrow, LP, liquidation, IRM hook
├── VaultMath.sol                  ← external library — M-01 index-scaling loops + _releaseAssetBorrows
├── interest/
│   ├── IInterestRateModel.sol     ← pluggable IRM interface
│   └── KinkedRateModel.sol        ← Aave V3-style two-slope curve (immutable per deploy)
├── oracle/
│   ├── PythPriceAdapter.sol       ← Chainlink-style AggregatorV3 wrapper over a Pyth feed
│   └── PythAdapterRegistry.sol    ← canonical adapter-per-priceId directory (T-4 audit fix)
└── mocks/
    ├── MockUSDC.sol               ← 6-dec stablecoin (testnet only)
    └── MockStockToken.sol         ← 18-dec equity stand-in (testnet only)

script/
├── Deploy.s.sol                   ← end-to-end USDG-vault deploy
└── DeployWethVault.s.sol          ← second vault that reuses adapters via the registry

test/
├── EquiFlowVault.t.sol            ← 123 tests
├── KinkedRateModel.t.sol          ← 14 tests (2 × 256-run fuzz)
└── PythAdapterRegistry.t.sol      ← 6 tests
```

---

## Quick start

```shell
# Build (with EIP-170 size budget: optimizer_runs=1, no metadata)
forge build

# Full test suite — 148 tests
forge test --summary

# Lint check (forge linter)
forge build 2>&1 | grep -E "warning|error" | sort -u
```

Build configuration (see `foundry.toml`):

```toml
[profile.default]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 1           # optimise for deploy-size, not runtime
via_ir = true
bytecode_hash = "none"       # strip CBOR metadata hash
cbor_metadata = false        # strip metadata trailer
```

These flags shaved 333 bytes off the vault and were necessary to fit the post-audit codebase under EIP-170 (24,576 bytes). Current vault bytecode: **24,493 bytes** (+82 byte margin).

---

## Deploy to Robinhood Chain testnet

```shell
source .env
# Required env vars in .env:
#   DEPLOYER_PK           — funded with testnet ETH (faucet)
#   RBN_RPC_URL           — https://rpc.testnet.chain.robinhood.com
#   PYTH_ADDRESS          — MockPyth address; deployer leaves empty for fresh
#   USDC_ADDRESS          — USDG live on RBN; leave empty for MockUSDC deploy
#   TOKEN_TSLA … TOKEN_AMD — live RBN stock tokens; leave empty for mocks

# IMPORTANT — RBN testnet rejects forge's simulated gas as "intrinsic too low".
# `--skip-simulation` makes the script use on-chain estimation directly.
forge script script/Deploy.s.sol \
  --rpc-url $RBN_RPC_URL \
  --broadcast \
  --skip-simulation
```

`Deploy.s.sol` performs the full bring-up in one script:

1. Deploy `VaultMath` library (auto-linked by Forge in subsequent contract deploys).
2. Deploy `EquiFlowVault` with 5 % flat legacy `borrowRateBps` (IRM not yet wired).
3. Deploy `PythAdapterRegistry`.
4. For each of TSLA / AMZN / PLTR / NFLX / AMD: deploy `PythPriceAdapter`, register it in the registry, and list it on the vault.
5. Deploy `KinkedRateModel` (`base 1 %`, `slope1 5 %`, `slope2 49 %`, `U_opt 85 %`).
6. Call `vault.scheduleIrm(kinkedRateModel)` — activation pending 24 h timelock.

Print block at the end exposes the addresses to copy into `app/.env.local`:

```
NEXT_PUBLIC_VAULT_ADDRESS=…
NEXT_PUBLIC_IRM_ADDRESS=…
NEXT_PUBLIC_ADAPTER_REGISTRY=…
```

### Activate the IRM (24 h after deploy)

```shell
cast send $VAULT "executeIrm()" \
  --rpc-url $RBN_RPC_URL \
  --private-key $DEPLOYER_PK
```

After this, `vault.borrowApyBps()` delegates through the active IRM and the rate becomes utilization-aware. Until then the vault uses the legacy 5 % flat rate — this is intended fallback behaviour, not a bug.

### Deploy a second vault that shares the same adapters

```shell
WETH_ADDRESS=0x7943e237c7F95DA44E0301572D358911207852Fa \
ADAPTER_REGISTRY=<from previous deploy log> \
forge script script/DeployWethVault.s.sol \
  --rpc-url $RBN_RPC_URL \
  --broadcast \
  --skip-simulation
```

The WETH vault deploy **requires** `ADAPTER_REGISTRY` (no silent fallback) and resolves the canonical `PythPriceAdapter` per priceId from the registry. Both vaults read the same fresh price each keeper tick — eliminates the cross-vault price drift identified as T-4 in the audit.

---

## Architecture notes

### Vault flow

```
Borrower:
  ─ pledgeAndBorrow(token, amount, borrowUsd)  →  collateral up,  USDG out
  ─ repay(amountUsd) / repayMax()              →  USDG in,        debt down
  ─ withdraw(token, amount)                    →  collateral out  (LTV checked)

LP (USDG capital provider):
  ─ announceDeposit(amount) → transfer USDG to vault → register(amount)
                                                       (CRIT-6 audit serialisation)
  ─ withdrawLp(shares)                                → USDG out, shares burned

Liquidator (open market):
  ─ liquidate(user, token, debtUsdToRepay)
      pays USDG, receives collateral + 5 % bonus (configurable, floored at 1 %)
      capped at closeFactorBps (≥ 10 %) unless HF < 0.5 (CRITICAL_HF)

Owner (timelocked actions, 24 h delay):
  ─ scheduleIrm                / executeIrm
  ─ scheduleWithdrawLiquidity  / executeWithdrawLiquidity
  ─ scheduleAssetWiden         / executeAssetWiden
  ─ scheduleWriteOffBadDebt    / executeWriteOffBadDebt
  ─ scheduleReserveFactorBps   / executeReserveFactorBps  (widening direction only)
  ─ scheduleLiquidationBonus   / executeLiquidationBonus  (widening direction only)
  ─ scheduleBorrowCap          / executeBorrowCap          (widening direction only)

Owner (instant):
  ─ pause / unpause            ─ disableAsset            (tightening / safety)
  ─ forceClearIrm              (emergency rescue — M-02 audit fix)
```

### Interest accrual

`borrowIndex` is a Compound-style multiplicative index (1e18 scale). Every mutating function calls `_accrueInterest()` first:

```
growthFactor = rate × dt × 1e18 / (BPS × SECONDS_PER_YEAR)
borrowIndex  = borrowIndex × (1 + growthFactor / 1e18)
totalBorrowedUsd += totalBorrowedUsd × growthFactor / 1e18
protocolReserves += interest × reserveFactorBps / BPS
```

After audit M-01: per-asset borrow counters (`totalBorrowedByAsset`, `userBorrowByAsset`) are scaled by the same growth factor in the same call, so `borrowCapUsd[t]` becomes a real debt-inclusive bound rather than a principal-only one. Index-scaling loops live in the external `VaultMath` library to keep the vault under EIP-170.

### Oracle path

```
PythAdapterRegistry  ──(register)──►  PythPriceAdapter#TSLA  ◄──(updatePrice)──  keeper
                                            │
                                            │ AggregatorV3Interface
                                            ▼
EquiFlowVault  ─ vault.listAsset(token, adapter, ltvBps, liqBps, staleAfter)
              ─ vault._price(token)            ← strict revert path (borrow / liquidate)
              ─ vault._safePriceOrZero(token)  ← stale-tolerant (multi-collateral views)
              ─ vault._enforceConfidence(t)    ← Pyth confidence width gate
```

---

## Security & audit

Seven audit rounds completed — see `../docs/SECURITY-AUDIT-*.md` for the per-pass finding log, and `../docs/SECURITY_RUNBOOK.md` for ops procedures (key rotation, IRM swap, emergency pause, force-clear, bad-debt write-off).

| Severity | Original | Resolved | Open |
|---|---:|---:|---:|
| Critical | 0 | — | **0** |
| High | 2 (H-01 `register()` over-announce, H-02 deviation freeze) | 2 | **0** |
| Medium | 5 (M-01 attribution drift, M-02 IRM brick, M-03 stale confidence, M-04 dust drain, M-05 instant bad-debt write-off) | 5 | **0** |
| Low | 11 (L-01..L-07, N-1..N-7 governance/operational) | 4 | 7 (defense-in-depth) |
| Informational | 17 (style, observability, deferred N-8 `delistAsset`) | 7 | 10 |

148 tests pass — 123 vault, 14 IRM (with 256-run fuzz), 6 registry. Five N-8 regression tests are temporarily removed alongside the `delistAsset` function, which was deferred until further bytecode optimization frees enough EIP-170 budget to re-introduce it.

---

## Foundry CLI cheat sheet

```shell
forge build                          # compile
forge test --summary                 # 148-test suite
forge test --match-test test_audit_  # only the audit regression tests (50)
forge test --gas-report              # per-function gas
forge coverage --report summary      # solidity coverage

cast call $VAULT "irm()(address)" --rpc-url $RBN_RPC_URL              # check active IRM
cast call $VAULT "borrowApyBps()(uint256)" --rpc-url $RBN_RPC_URL     # live borrow rate (bps)
cast call $VAULT "utilizationBps()(uint256)" --rpc-url $RBN_RPC_URL   # vault utilisation (bps)
cast call $IRM "getBorrowRate(uint256)(uint256)" 5000 --rpc-url $RBN_RPC_URL  # IRM curve sample
```

---

## License

MIT
