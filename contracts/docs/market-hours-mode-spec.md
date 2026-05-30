# EquiFlow — Market-Hours Mode (Design Spec)

**Problem.** Collateral = tokenized US equities (trade ~6.5h/weekday). EquiFlow is
24/7. When the market is closed there is no live price, so today the feed goes
stale (`staleAfter` 1h) → collateral values to **0** → borrows blocked abruptly,
and within the 1h "fresh" window a wrong/seed price **undervalues** collateral.
Neither is what we want.

**Goal.** A first-class "market closed" mode: value positions at the **last
close**, allow only **risk-reducing** actions when closed, and resume cleanly
(with a grace period) at open — driven by an explicit **market-status signal**,
not by a staleness timeout.

**Industry basis** (verified): Synthetix *suspended* equity synths when the
underlying market closed; gTrade/Ostium gate stock orders to market hours;
Stork exposes a **market-status endpoint** (current/next/holidays) and recommends
a **conservative margin buffer** for overnight gaps; Pyth publishes equity
**hours + session feeds** but **no on-chain status field** (you build detection).
Convergent pattern: *use last-close for valuation + restrict risky ops when
closed + grace at open + conservative buffers, gated on market status.*

---

## 1. Market-status model

Per asset, status ∈ { `OPEN`, `EXTENDED` (pre/post), `CLOSED`, `HALTED`, `OPEN_GRACE` }.

**Source of truth = the keeper** (it already knows hours and runs the Pyth
session feeds). The keeper computes status from: Pyth published hours +
US-market holiday calendar + session price-IDs (`PYTH_PRICE_IDS_BY_SESSION`),
or from a Stork status endpoint. The keeper drives both the on-chain price
(last-close while closed) and the on-chain status flag.

> On-chain schedule/holiday math is impractical (gas, calendar upkeep). Keep the
> status decision off-chain (keeper-trust, same model as price pushes), and let
> the contract enforce only a small, auditable gate.

---

## 2. Behavior matrix (what each state permits)

| Action | OPEN | EXTENDED | CLOSED | HALTED | OPEN_GRACE |
|---|---|---|---|---|---|
| Valuation (HF, LTV) | live | live | **last close** | last close | live |
| Add collateral (pledge) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **New borrow / increase debt** | ✅ | ✅ (wider buffer) | ❌ | ❌ | ❌ |
| Repay / repayMax | ✅ | ✅ | ✅ | ✅ | ✅ |
| Withdraw collateral | ✅ | ✅ | only if HF stays safe* | ❌ | ✅ |
| **Liquidation** | ✅ | ✅ | ⚠️ pause (or last-close + buffer) | ❌ pause | ⏳ paused until grace ends |
| LP deposit/register | ✅ | ✅ | ✅ | ✅ | ✅ |
| LP withdraw | ✅ | ✅ | restrict** | restrict | ✅ |

\* Risk-reducing only. \** Optional: block LP withdraw when closed so NAV can't be
gamed off a frozen price. Conservative-default = block.

Principles: **closed → no new leverage, no liquidations, positions held at last
close**; grace at open absorbs the opening gap; **lower max-LTV** on gap-prone
names.

---

## 3. Architecture — off-chain vs on-chain (decides redeploy)

The decisive question is which behaviors need **vault logic** (non-upgradeable →
redeploy) vs can be done with the **keeper + existing primitives** (no redeploy).

| Behavior | Mechanism | Redeploy? |
|---|---|---|
| Value at **last close** when closed | keeper keeps pushing the official close (fresh `publishTime`) **+ lengthen `staleAfter`** to span the closed window (`updateAssetRiskParams`, longer = instant) | **No** |
| **Block new borrows** when closed | `pause()` (global) **or** `disableAsset(token)` per asset, toggled by owner/keeper at close/open (`enableAsset` re-opens) | **No** |
| **Conservative LTV** for gaps | `updateAssetRiskParams` (lower LTV = instant) | **No** |
| Existing positions keep `repay`/add-collateral when closed | `repay`/`repayMax` are not `whenNotPaused`; pledge allowed unless asset disabled | **No** |
| **Pause LIQUIDATIONS when closed** | ⚠️ no primitive — `liquidate` is NOT `whenNotPaused` and ignores `enabled`. Only staleness pauses it, which conflicts with "value at last close". | **YES** |
| **Liquidation GRACE at open** | needs a timestamp gate inside `liquidate` | **YES** |
| Explicit per-asset **status flag** (clean gating vs pause/stale side-effects) | new state + setter | **YES** |
| Per-asset **borrow-only** gate (block borrow but still allow add-collateral) | `disableAsset` also blocks pledge; a borrow-only gate needs vault code | **YES** |

---

## 4. Tier 1 — "Market-hours mode, no redeploy" (works on the deployed vault)

Achievable **today** on `0x583A…C590` using the keeper + owner calls:

1. **Keeper computes status** (open/closed) from market hours + holidays.
2. **On close:** push the **official close** once (fresh stamp) so collateral is
   valued at the real close; **`updateAssetRiskParams` to lengthen `staleAfter`**
   (e.g. 72h) so it stays valid through the weekend; then **`pause()`** (or
   `disableAsset` per asset) to block new borrows.
3. **On open:** `unpause()` / `enableAsset`; resume live pushes; (de-facto grace
   by delaying the first live push a few minutes).
4. **Buffers:** set conservative max-LTV per asset.

**What Tier 1 gives:** last-close valuation, no new borrows when closed,
conservative buffers, repay/add-collateral still available.

**What Tier 1 CANNOT do cleanly:**
- **Cannot pause liquidations** while keeping last-close valuation (no on-chain
  lever). You either (a) accept liquidations at the frozen last-close — defensible
  for tokenized stocks that don't trade weekends, paired with conservative
  buffers (Ostium-style), or (b) let the price go stale to block liquidations —
  but that also zeroes valuation and re-introduces today's problem.
- **No real liquidation grace** at open (only the keeper's push timing).
- Borrow-block via `pause`/`disableAsset` is coarse (also blocks LP/withdraw or
  pledge respectively).

---

## 5. Tier 2 — "Robust market-hours mode" (requires redeploy)

Decouple **valuation freshness** from **action gating**: the keeper holds the
last-close price (valued normally); a separate **status flag** gates borrow and
liquidation. Minimal vault additions:

```solidity
enum MarketStatus { OPEN, CLOSED, HALTED }          // per asset
mapping(address => MarketStatus) public marketStatus;
mapping(address => uint64) public marketOpenedAt;    // for grace
uint64 public constant LIQ_GRACE = 5 minutes;

// keeper-set (add a keeper allowlist to the vault, or reuse onlyOwner).
function setMarketStatus(address token, MarketStatus s) external onlyMarketKeeper {
    if (s == MarketStatus.OPEN && marketStatus[token] != MarketStatus.OPEN)
        marketOpenedAt[token] = uint64(block.timestamp);
    marketStatus[token] = s;
    emit MarketStatusSet(token, s);
}

// pledgeAndBorrow (when borrowUsd>0) / _attributeBorrow:
//   for each collateral asset t the user borrows against:
//   require(marketStatus[t] == OPEN, "market closed");

// liquidate(token):
//   require(marketStatus[token] == OPEN, "market closed");
//   require(block.timestamp >= marketOpenedAt[token] + LIQ_GRACE, "open grace");
```

- Valuation keeps using `_safePriceOrZero` over the **held last-close** (keeper +
  long `staleAfter`), so HF/LTV read real numbers when closed.
- Borrow gate = `OPEN` only. Liquidation gate = `OPEN` **and** past the grace.
- Pledge/repay/withdraw(risk-reducing) stay allowed when closed.
- Optional: `EXTENDED` status with a tighter LTV multiplier; LP-withdraw gate.

**Bytecode note:** the vault has **261 B** of margin (EIP-170). The additions
above are ~400–600 B, so Tier 2 also needs to **reclaim space** — e.g. move the
H-1 collateral-seize loop or the deposit-intent block into `VaultMath` (external
library, ~23 KB free), or fold the staleness check into the status gate. Plan
this as part of the redeploy.

---

## 6. Does it require a contract redeploy?

- **Tier 1 (last-close valuation + block new borrows + conservative buffers): NO
  redeploy.** It uses the keeper plus existing owner primitives (`pause` /
  `disableAsset`+`enableAsset` / `updateAssetRiskParams`) on the live vault.
- **Tier 2 (pause LIQUIDATIONS when closed + grace at open + explicit per-asset
  status gate): YES, redeploy** — the vault is non-upgradeable (constructor, no
  proxy), and these need new on-chain logic. Bundle with any other pending fix
  into one redeploy, and reclaim bytecode (VaultMath) to fit.

**Decision rule:** if liquidating at the frozen last-close is acceptable (it is
for equities that don't trade nights/weekends, with conservative LTVs), **Tier 1
is enough — no redeploy.** If you require liquidations to be *paused* while closed
and a grace at open (the safest, Synthetix-style), **redeploy for Tier 2.**

---

## 7. Risks & tradeoffs
- **Weekend gap risk:** holding the last-close means the protocol can't react to
  off-market news. Mitigate with conservative LTV + (Tier 2) liquidation grace at
  open. Inherent to all tokenized-equity protocols.
- **Keeper trust:** status + close-price are keeper-driven (same trust as price
  pushes; RBN has no on-chain Wormhole verification). Use ≥2 keepers + monitoring.
- **`staleAfter` lengthening weakens weekday staleness protection** during a
  keeper outage — pair with a separate liveness alert on the keeper.
- **Liquidations at last-close** can be unfair if the position would have been
  healthy at the (unknown) live price — bounded for equities (no weekend trading)
  and by buffers; Tier 2's pause removes it entirely.

## 8. Recommendation
1. **Now (no redeploy):** ship Tier 1 — keeper pushes the official close at
   market close, lengthen `staleAfter`, `pause`/`disableAsset` to block borrows,
   lower LTVs. This already fixes the "$198 seed / undervalued / 0-value" issue.
2. **Next redeploy:** add Tier 2 (status flag + liquidation pause + open grace),
   reclaiming bytecode via VaultMath. Consider migrating to Arbitrum (real Pyth)
   or Stork for an on-chain/authoritative status signal at the same time.
