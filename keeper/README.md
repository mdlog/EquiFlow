# EquiFlow Keeper (Hermes → MockPyth)

Relays **real Pyth Hermes** prices (price + confidence + expo + publishTime) into
the on-chain `MockPyth` via `PythPriceAdapter` on Robinhood Chain testnet, so the
testnet runs on real market data. Full design: [`../contracts/docs/keeper-relay-spec.md`](../contracts/docs/keeper-relay-spec.md).

> Trusted-keeper model: RBN has no on-chain Wormhole/Pyth, so updates are not
> signature-verified on-chain (audit finding #5, accepted for testnet). The keeper
> is the trust boundary — run ≥2 instances and validate inputs. One `MODE` flag
> away from signature-verified Pyth on Arbitrum (spec §9).

## Run

```bash
cd app
npm install
cp keeper/.env.example keeper/.env   # fill RBN_RPC_URL, KEEPER_PK, ADAPTER_REGISTRY
npm run keeper:test                  # unit tests (pure core)
npm run keeper                       # start the relay loop
```

The keeper account must be authorized: `adapter.setKeeper(<keeper>, true)` (the
deploy script authorizes the deployer; add more keepers for redundancy).

## What it does each tick (default 60s)

1. Fetch all feeds from Hermes (`/v2/updates/price/latest?ids[]=…&parsed=true`).
2. Per feed, read the on-chain cached price/`updatedAt` and decide ([`core.ts` `decide`](./core.ts)):
   - skip if Hermes `publish_time` is not newer, or already older than `maxAge` (market closed → stale by design);
   - otherwise push if the heartbeat is due **or** deviation ≥ `DEV_TRIGGER_BPS`.
3. Encode the raw Hermes values as `abi.encode(PythStructs.PriceFeed)` (the adapter
   normalizes price `_toE8` and confidence `_confToE8` on-chain — **do not pre-scale**).
4. `updatePrice` if within the 5% cap, else `forceUpdatePrice` (only succeeds ≥30 min
   after the last write). Simulated first; reverts are decoded and the loop never crashes.

## Bootstrap (first run after deploy)

The deploy seeds a hand-set `initialPriceE8` and `_lastConf = 0`. **Push every feed
once (real price + conf) before opening borrows** — until then the confidence
breaker reads 0 bps and fails open. If a seed is >5% off market (e.g. the TSLA seed),
the first `updatePrice` reverts on the cap; either refresh the seeds in
`Deploy.s.sol` or wait 30 min and let the keeper `forceUpdatePrice`. See spec §10.

## Files

| File | Purpose |
|---|---|
| `core.ts` | pure logic: `toE8`, `deviationBps`, `encodePriceFeed`, `decide` (unit-tested) |
| `core.test.ts` | `node --import tsx --test` unit tests |
| `abi.ts` | adapter + registry ABIs (incl. custom-error fragments) |
| `config.ts` | feed list (priceIds) + env config |
| `hermes.ts` | Hermes fetch |
| `relay.ts` | per-feed decide + push (viem, resilient revert decoding) |
| `index.ts` | main loop (adapter resolution + heartbeat) |
