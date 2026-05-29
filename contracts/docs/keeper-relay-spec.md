# EquiFlow Keeper Relay Spec — Pyth Hermes → MockPyth (Robinhood Chain testnet)

**Status:** spec for implementation
**Target:** Robinhood Chain testnet (chainId 46630), `MockPyth` + `PythPriceAdapter`
**Goal:** drive the on-chain price feeds with **real Pyth market data** relayed from
Hermes, instead of static/manual prices — so the testnet behaves like production
(real prices + real confidence), the confidence circuit-breaker is exercised, and
the `_lastConf = 0` fail-open window is closed.

> RBN has **no native Pyth/Wormhole**, so on-chain Wormhole signature verification
> is not possible there. This relay is therefore a **trusted-keeper** model
> (audit finding #5, accepted for testnet). The keeper is the trust boundary —
> hence the off-chain validation in §8. For genuine on-chain verification, deploy
> on a Pyth-native chain (Arbitrum Sepolia/One); the adapter is wire-compatible
> and the migration is one address + the binary-payload mode in §9.

---

## 1. Data flow

```
Pythnet (aggregation)
   │  signed price updates
   ▼
Hermes REST  ──GET /v2/updates/price/latest?ids[]=…──►  Keeper bot (off-chain)
                                                          │  parse price/conf/expo/publish_time
                                                          │  validate (§8) + decide (§6,§7)
                                                          │  abi.encode(PythStructs.PriceFeed)   ← MockPyth format, NOT the VAA
                                                          ▼
                              PythPriceAdapter.updatePrice([data])  (onlyKeeper)
                                 └─ MockPyth.updatePriceFeeds(data) (stores by priceId)
                                 └─ getPriceNoOlderThan(priceId, maxAge=1h)
                                 └─ _toE8(price,expo) + _confToE8(conf,expo)  ← on-chain normalization to 1e8
                                                          ▼
                              EquiFlowVault reads via AggregatorV3Interface
```

One **adapter per priceId** (registered in `PythAdapterRegistry`). The keeper pushes
each feed to its own adapter.

---

## 2. Hermes endpoint

```
GET https://hermes.pyth.network/v2/updates/price/latest
      ?ids[]=<priceId-hex>            (repeat for each feed; one request can carry all)
      &ids[]=<priceId-hex>
      &parsed=true                    (we consume `parsed`, not `binary`)
      &encoding=hex
```

- `parsed=true` returns human-decoded values (what MockPyth needs).
- `binary.data[]` is the Wormhole VAA — **only** for real Pyth (§9). MockPyth cannot use it.
- Price IDs are the ones already hard-coded in `script/Deploy.s.sol` (`AssetSpec.priceId`),
  e.g. TSLA `0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1`.
  Hermes accepts ids with or without the `0x` prefix.

### Response shape (verified live, TSLA)

```json
{
  "binary": { "encoding": "hex", "data": ["504e4155...vaa..."] },
  "parsed": [
    {
      "id": "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
      "price":     { "price": "43380934", "conf": "30066", "expo": -5, "publish_time": 1780063858 },
      "ema_price": { "price": "43748264", "conf": "32142", "expo": -5, "publish_time": 1780063858 },
      "metadata":  { "slot": 293596951, "proof_available_time": 1780063862, "prev_publish_time": 1780063857 }
    }
  ]
}
```

> ⚠️ **`expo` is per-feed and is NOT −8.** The live TSLA feed uses **`expo = -5`**
> (`43380934 × 10⁻⁵ = $433.81`). Do **not** assume −8 and do **not** pre-scale.
> Pass the **raw** `price`, `conf`, `expo`, `publish_time` straight into the
> `PriceFeed` struct — the adapter normalizes both price (`_toE8`) and confidence
> (`_confToE8`) to 1e8 on-chain. (This is exactly why audit fix #2 matters: with a
> −5 feed, the confidence-width check would be mis-scaled if `conf` were stored raw.)

### Field → struct mapping

| Hermes `parsed[i]` | type | → `PythStructs.PriceFeed` field | solidity type |
|---|---|---|---|
| `id` (add `0x`) | hex string | `id` | `bytes32` |
| `price.price` | decimal **string** | `price.price` | `int64` |
| `price.conf` | decimal **string** | `price.conf` | `uint64` |
| `price.expo` | int | `price.expo` | `int32` |
| `price.publish_time` | unix seconds | `price.publishTime` | `uint256` |
| `ema_price.*` | — | `emaPrice.*` | (adapter ignores ema; copy for fidelity) |

Parse the string fields as **BigInt** (TSLA at expo −8 would overflow JS numbers; always BigInt).

---

## 3. Encoding for MockPyth (the critical detail)

MockPyth's `updatePriceFeeds(bytes[] updateData)` does `abi.decode(updateData[i], (PythStructs.PriceFeed))`.
So each element of the `bytes[]` is simply:

```
abi.encode(PythStructs.PriceFeed{
  id,
  price:    Price{ price, conf, expo, publishTime },
  emaPrice: Price{ price, conf, expo, publishTime }
})
```

ABI tuple type (off-chain encoders):

```
tuple(
  bytes32,
  tuple(int64, uint64, int32, uint256),   // price
  tuple(int64, uint64, int32, uint256)    // emaPrice
)
```

Two ways to build it:
- **Off-chain (recommended):** `AbiCoder.encode(...)` (ethers/viem) — full control, no extra RPC.
- **On-chain helper:** `MockPyth.createPriceFeedUpdateData(id, price, conf, expo, emaPrice, emaConf, uint64 publishTime)` returns the same `abi.encode`. (Note its `publishTime` param is `uint64` and it sets both price & ema.) Avoid unless you want a view round-trip.

---

## 4. On-chain constraints the keeper MUST respect

Derived from `PythPriceAdapter` + `MockPyth` (post-2026-05 audit fixes):

| Constraint | Where | Keeper obligation |
|---|---|---|
| `onlyKeeper` | adapter `updatePrice`/`forceUpdatePrice` | push from an address added via `setKeeper(addr,true)` |
| `getUpdateFee == 0` (MockPyth `singleUpdateFeeInWei=0`) | MockPyth | send `value: 0`. (Real Pyth: `value ≥ getUpdateFee`; excess refunded via `claimRefund`.) |
| **publishTime strictly increasing** | MockPyth (`lastPublishTime < new`) | only push when Hermes `publish_time` advanced |
| **publishTime ≥ cached** (L-2 fix) | adapter `_applyUpdate` `require(p.publishTime >= _updatedAt)` | same as above — never relay an older stamp |
| **not too old vs chain** (H-01) | adapter: revert if `block.timestamp - publishTime > maxAge (1h)` | push promptly; watch keeper↔chain clock skew |
| **deviation cap 5%** (`maxDeviationBps=500`) | adapter `_applyUpdate(enforceDeviation=true)` on `updatePrice` | each `updatePrice` must be within 5% of the cached e8 price; else use `forceUpdatePrice` |
| **override delay 30 min** (`DEVIATION_OVERRIDE_DELAY`, vs wall-clock `_lastWriteAt`) | adapter `forceUpdatePrice` | `forceUpdatePrice` only succeeds ≥30 min after the last accepted write |
| price normalized on-chain (`_toE8`), conf normalized (`_confToE8`) | adapter | pass **raw** Hermes values; never pre-scale |
| exponent bound `[-18, 18]` (M-01) | adapter | Hermes equity expo (−5/−8) is always in range |

---

## 5. Per-asset config (current deploy)

| Param | Value | Source |
|---|---|---|
| `staleAfter` (vault) | 1 hour | `Deploy.s.sol` per asset |
| `maxAge` (adapter `getPriceNoOlderThan`) | 1 hour | adapter ctor |
| `maxConfWidthBps` (vault) | 150 (1.5%) | `setMaxConfidenceWidth` |
| `maxDeviationBps` (adapter) | 500 (5%) | `setMaxDeviation` |
| `DEVIATION_OVERRIDE_DELAY` | 30 min | adapter constant |
| `MAX_CONF_WIDTH_BPS_CEILING` | 2000 | adapter/vault constant (cap on the above) |

Feeds: TSLA, AMZN, PLTR, NFLX, AMD (priceIds in `Deploy.s.sol`).

---

## 6. Cadence + deviation trigger

Push when **either** fires (and `publish_time` advanced and the asset's market is open, §7e):

- **Heartbeat:** every `HEARTBEAT` (recommend **5 min** during market hours; ≤ 60 s for a
  live demo). Must be ≪ `staleAfter` (1h) with margin so the feed never goes stale mid-session.
- **Deviation:** push immediately when `|e8(new) − e8(cached)| / e8(cached) ≥ DEV_TRIGGER`,
  with `DEV_TRIGGER` small (recommend **0.5%**). Keeping the cached price close to market
  means consecutive pushes almost never exceed the 5% on-chain cap, so `forceUpdatePrice`
  is reserved for genuine gap moves (market reopen / earnings).

Off-chain e8 helper (mirror of `_toE8`) for the deviation check:

```ts
const toE8 = (price: bigint, expo: number): bigint =>
  expo === -8 ? price
  : expo < -8 ? price / 10n ** BigInt(-expo - 8)
  :             price * 10n ** BigInt(expo + 8);
```

Read the cached e8 price from `adapter.latestRoundData()` (`answer`, already e8) and
`updatedAt` (= last `publishTime`).

---

## 7. updatePrice vs forceUpdatePrice — decision flow

Use **try/updatePrice → fallback forceUpdatePrice** (no need to read private `_lastWriteAt`):

```
for each feed f:
  hermes = fetch(parsed for f.priceId)
  (_, cachedE8, _, updatedAt, _) = adapter.latestRoundData()   # updatedAt = last publishTime

  # (a) PRE-CHECK only-newer. MockPyth silently NO-OPS on an equal/older stamp
  #     (it never reverts); the read-back would then return the unchanged price,
  #     and a sufficiently old cached price makes getPriceNoOlderThan revert
  #     StalePrice. Skipping here avoids a wasted/failing tx.
  if hermes.publish_time <= updatedAt: continue

  # (b) PRE-CHECK freshness. Skip if the Hermes stamp is already older than
  #     maxAge (1h) vs now — i.e. market closed / very stale (§7e). This avoids
  #     the StalePrice / PublishTimeTooOld reverts entirely in normal operation.
  if now - hermes.publish_time > MAX_AGE (1h): continue   # asset goes stale by design

  data = abiEncodeFeed(hermes)            # raw price/conf/expo/publish_time

  # (c) within cap → normal path
  try:
      adapter.updatePrice([data], value=0)
      continue
  catch Error(string) "price deviation too large":     # gap move > 5%
      # (d) legitimate gap → override, but only after the 30-min delay
      try:
          adapter.forceUpdatePrice([data], value=0)
          log PriceForceUpdated          # monitor these
      catch Error(string) "override too soon":
          # < 30 min since last write AND > 5% move ⇒ suspicious.
          # Do NOT force. Alert + retry next tick. (Anti-compromise: this is
          # the H-02 guarantee — a compromised keeper can't instantly bypass.)
          alert(f, "large move within override delay")
  catch ANY other revert:                # custom errors (StalePrice, PublishTimeTooOld,
      # InvalidPrice, ExponentOutOfRange, NotAuthorizedKeeper) OR transient RPC.
      # Log + skip this tick — NEVER crash the loop. Custom errors only surface a
      # readable name if their fragments are in the contract ABI (see §11).
      log(f, "skip", decodeRevert(e)); continue
```

> Note on revert types: `"price deviation too large"`, `"override too soon"`, and
> the L-2 `"stale publishTime"` are `require(...)` **Error(string)** reverts (ethers
> surfaces them in `e.reason`). `PublishTimeTooOld`, `InvalidPrice`,
> `ExponentOutOfRange`, `NotAuthorizedKeeper` (adapter) and `StalePrice` (bubbled from
> Pyth's `getPriceNoOlderThan`) are **custom errors** — ethers only decodes their
> NAME if the error fragment is in the ABI, and they appear on `e.revert?.name`, not
> `e.message`. The pre-checks (a)+(b) make these reverts rare; the catch-all keeps the
> keeper resilient if one slips through.

### 7e. Market-hours handling (US equities)

Pyth equity feeds only update during regular US market hours. Outside hours,
`publish_time` stops advancing and Hermes returns the last value:

- The keeper **must not** fabricate a newer `publish_time` (that would push a
  stale price as fresh — dishonest, and MockPyth/L-2 reject equal/older stamps anyway).
- So outside hours the feed naturally goes **stale** after `staleAfter` (1h). The vault
  then values that asset at 0 (conservative): borrows/withdraws restricted, liquidation
  of that leg paused (audit M-3, by-design). Multi-collateral positions still operate on
  fresh legs.
- **Policy options:** (i) accept overnight/weekend staleness (default, safest), or
  (ii) raise per-asset `staleAfter` to tolerate the closed window — only if you accept
  a longer stale-but-tradeable window. Document whichever you pick.

---

## 8. Security hardening (keeper is the trust boundary on RBN)

Because RBN has no on-chain signature verification, enforce off-chain:

1. **Push real `conf` on the FIRST update per asset, before borrows open.** Until the
   first push, the adapter's `_lastConf = 0`, so the 1.5% confidence breaker reads 0 bps
   and fails **open**. Bootstrapping all feeds (§10) closes this.
2. **Multi-keeper redundancy.** Run ≥2 independent keepers (different infra/keys), each
   `setKeeper`-authorized. Mitigates single-keeper liveness/compromise (finding #5).
3. **Validate Hermes data before pushing:** `publish_time` fresh (within a few seconds of
   `now`); `conf/price` ratio sane; price within an absolute sanity band per asset
   (reject obvious anomalies). The on-chain deviation cap is a backstop, not the primary
   filter.
4. **Optional cross-check:** compare Hermes price with a second source; skip/alert on
   large divergence before relaying.
5. **Monitor `PriceForceUpdated` events.** Every override is a deviation-cap bypass —
   alert and review (audit L-3 residual).
6. **forceUpdatePrice discipline:** never auto-force on a `>5%` move that occurs `<30 min`
   after the last write (the flow above already refuses it). Only force for corroborated,
   legitimate gaps.

---

## 9. Migration to real Pyth (Arbitrum Sepolia/One) — no code change

The adapter is wire-compatible. To switch the keeper to a Pyth-native chain:

- Deploy with `PYTH_ADDRESS` = real Pyth (Arb Sepolia `0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF`,
  Arb One `0xff1a0f4744e8582DF1aE09D5611b887B6a12925C`; post-2026-07-31 use the upgraded addrs).
- Keeper change: push the **`binary.data[]` VAA hex** from Hermes as `updateData` (NOT
  `abi.encode(PriceFeed)`), and send `value = getUpdateFee(updateData)` (non-zero). The
  real Pyth contract then **verifies Wormhole signatures** on-chain — the trusted-relay
  assumption disappears.
- Everything else (cadence, deviation/force logic, normalization) is identical.

Keep the keeper's encoder behind a `MODE = mock | real` flag.

---

## 10. Bootstrap at deploy (first sync)

The deploy seeds `initialPriceE8` (hand-set) and `_lastConf = 0`. The first real push
must reconcile both:

- The seed may be **stale** vs market (verified: TSLA seed `$348.51` vs live `$433.81` ≈
  24% off → first `updatePrice` reverts on the 5% cap).
- **Recommended:** refresh `initialPriceE8` in `Deploy.s.sol` to the current Hermes price
  at deploy time (within 5%), so the first `updatePrice` succeeds and sets real `conf`.
- **Fallback:** after deploy, wait `DEVIATION_OVERRIDE_DELAY` (30 min) then `forceUpdatePrice`
  each asset once to sync price + conf. (A fresh adapter's `_lastWriteAt` = deploy time, so
  force is unavailable for the first 30 min.)
- **Gate borrowing** (e.g., keep assets effectively unborrowable, or don't advertise) until
  every feed has had ≥1 successful real push (price + conf). Then enable.
- After the IRM timelock (24h), `executeIrm()`.

---

## 11. Reference keeper (ethers v6 sketch)

```ts
import { AbiCoder, Contract, JsonRpcProvider, Wallet } from "ethers";

const HERMES = "https://hermes.pyth.network/v2/updates/price/latest";
const PRICE  = "tuple(int64 price,uint64 conf,int32 expo,uint256 publishTime)";
const FEED   = `tuple(bytes32 id,${PRICE} price,${PRICE} emaPrice)`;
const coder  = AbiCoder.defaultAbiCoder();

const ADAPTER_ABI = [
  "function updatePrice(bytes[] updateData) payable",
  "function forceUpdatePrice(bytes[] updateData) payable",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  // custom-error fragments so ethers can decode revert NAMES (e.revert.name).
  // The require-string reverts surface in e.reason without these.
  "error PublishTimeTooOld(uint256 publishTime, uint256 blockTimestamp)",
  "error InvalidPrice(int64 raw)",
  "error ExponentOutOfRange(int32 expo)",
  "error NotAuthorizedKeeper()",
  "error StalePrice()", // bubbled from Pyth getPriceNoOlderThan
];

const MAX_AGE = 3600n; // adapter maxAge / vault staleAfter = 1h

const toE8 = (p: bigint, e: number) =>
  e === -8 ? p : e < -8 ? p / 10n ** BigInt(-e - 8) : p * 10n ** BigInt(e + 8);

function encode(pf: any): string {
  const px = (x: any) => ({
    price: BigInt(x.price), conf: BigInt(x.conf), expo: x.expo, publishTime: BigInt(x.publish_time),
  });
  return coder.encode([FEED], [{ id: "0x" + pf.id, price: px(pf.price), emaPrice: px(pf.ema_price) }]);
}

async function relay(feed: { priceId: string; adapter: string }, signer: Wallet) {
  const res = await fetch(`${HERMES}?ids[]=${feed.priceId}&parsed=true&encoding=hex`);
  const { parsed } = await res.json();
  const pf = parsed.find((p: any) => "0x" + p.id === feed.priceId.toLowerCase());
  if (!pf) return;

  const a = new Contract(feed.adapter, ADAPTER_ABI, signer);
  const [, cachedE8, , updatedAt] = await a.latestRoundData();

  const pubTime = BigInt(pf.price.publish_time);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (pubTime <= updatedAt) return;            // (a) not newer — MockPyth would no-op
  if (now - pubTime > MAX_AGE) return;         // (b) stale/market-closed (§7e) — avoids StalePrice revert
  // (also validate conf/price ratio + absolute sanity band here — §8.3)

  // ethers v6: require-strings → e.reason; decoded custom errors → e.revert?.name
  const reasonOf = (e: any): string => e?.reason ?? e?.revert?.name ?? e?.shortMessage ?? e?.message ?? "";

  const data = encode(pf);
  try {
    await (await a.updatePrice([data], { value: 0n })).wait();
  } catch (e: any) {
    if (reasonOf(e) === "price deviation too large") {       // gap move > 5%
      try {
        await (await a.forceUpdatePrice([data], { value: 0n })).wait();
        // log PriceForceUpdated — monitor (audit L-3)
      } catch (e2: any) {
        // "override too soon" => <30m since last write; suspicious, do not force.
        // Any other failure => log + skip; NEVER crash the loop.
        log(feed, "force skipped", reasonOf(e2));
      }
    } else {
      // StalePrice / PublishTimeTooOld / transient RPC / etc. → log + skip this tick.
      log(feed, "skip", reasonOf(e));
    }
  }
}
```

Run `relay()` for every feed on the heartbeat tick; additionally trigger on the
`DEV_TRIGGER` deviation check between heartbeats.

---

## 12. Summary

- **MockPyth stays** (RBN has no native Pyth); the upgrade is the **data source**, not the contract.
- Relay **real Hermes price + conf + raw expo + publish_time**; let the adapter normalize.
- Respect: strict-increasing `publishTime`, 5% deviation cap (else 30-min `forceUpdatePrice`),
  `onlyKeeper`, fee 0.
- Bootstrap all feeds (real conf) **before** opening borrows to close the `_lastConf=0` window.
- Harden off-chain (multi-keeper, sanity bounds, monitoring) — the keeper is the trust boundary.
- One `MODE` flag away from real signature-verified Pyth on Arbitrum.
