# EquiFlow Security Runbook

Operator-side actions required to keep the production deployment secure.
Codifies the items from the 2026-05-28 audit that **cannot be fixed in code**
and must be done by the team running the deployment.

---

## 1. Rotate the keeper signing key (audit CRIT-1)

The `KEEPER_PRIVATE_KEY` that signed `adapter.updatePrice()` and (eventually)
`vault.repay()` is one credential away from full oracle takeover. Treat it
like a vault key.

### When to rotate
- **Immediately**: if `.env.local` has been shared, screen-shared, backed up
  to unencrypted storage, or had the key visible to any AI/coding assistant.
- **Quarterly**, regardless of suspected compromise.
- **On any deployment to a new infrastructure provider** (Vercel project
  swap, new Railway/Fly app, etc).

### How to rotate
```bash
# 1. Generate a new keypair offline.
cast wallet new
# → Address: 0xNEW
# → Private key: 0xNEWPK

# 2. Fund the new EOA from the deployer wallet (testnet ETH).
cast send 0xNEW --value 0.5ether --private-key $DEPLOYER_PK \
  --rpc-url https://rpc.testnet.chain.robinhood.com

# 3. Authorize the new keeper on every adapter, deauthorize the old one.
for ADAPTER in $TSLA_ADAPTER $AMZN_ADAPTER ...; do
  cast send $ADAPTER "setKeeper(address,bool)" 0xNEW true \
    --private-key $DEPLOYER_PK
  cast send $ADAPTER "setKeeper(address,bool)" 0xOLD false \
    --private-key $DEPLOYER_PK
done

# 4. Update production env (NEVER `.env.local` — use Vercel/Railway dashboard).
#    Replace KEEPER_PRIVATE_KEY with 0xNEWPK.

# 5. Drain the old EOA back to deployer.
cast send $DEPLOYER --value $(cast balance 0xOLD --rpc-url ...) \
  --private-key 0xOLDPK
```

### Where the key must NEVER live
- Working tree files (even `.env.local`). Use 1Password CLI / direnv / Vault.
- Git history (use `git secret-scan` or `trufflehog` in CI).
- Vercel preview deploys (set ENV at `Production` scope only).
- AI agent transcripts / screenshare recordings.

---

## 2. Generate and set `CRON_SECRET` (audit CRIT-10)

The `/api/keeper/{cron,tick}` endpoints fail-closed in production without
`CRON_SECRET`. They reject every request with `503 secret_not_configured`.

```bash
openssl rand -hex 32
# → e.g. 7a8b3c... 64 chars
```

Set in:
- Vercel: Project Settings → Environment Variables → Production → `CRON_SECRET`.
- Vercel Cron auto-injects this header on scheduled runs — no extra config.
- External schedulers (cron-job.org, GH Actions) must send:
  `Authorization: Bearer <CRON_SECRET>`.

The middleware uses `crypto.timingSafeEqual` so naive byte-by-byte
brute-force is not viable, but rotate the secret if you suspect leakage.

---

## 3. Restrict the Alchemy API key by domain (audit H-10)

`NEXT_PUBLIC_ALCHEMY_API_KEY` ships in the client bundle. Without domain
allowlisting it can be scraped and used by anyone to:
- Burn through your bundler quota.
- Drain the paymaster policy you sponsored (`NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID`).

### Steps
1. dashboard.alchemy.com → Apps → your EquiFlow app → Settings.
2. **Allowed Origins**: lock to your production domain(s) only
   (e.g. `equiflow.app`, `*.equiflow.app`, NOT `*`).
3. **Gas Manager Policy** → Sender Allowlist:
   - Add only the contract addresses your UserOps will call
     (`EQUIFLOW_VAULT_ADDRESS`, your stock tokens).
   - Without this restriction, anyone with the key can spam UserOps
     calling arbitrary contracts and burn your sponsored gas budget.
4. **Rate limit**: set per-IP cap on Alchemy dashboard to ~30 RPS.

---

## 4. Rotate Upstash REST credentials

`UPSTASH_REDIS_REST_TOKEN` is server-only but lives in `.env.local`. Same
rotation discipline as the keeper key:

```
console.upstash.com → your database → REST API → "Regenerate Token"
```

Update production env, then delete the old token. The defender store and
price history will reconnect on next request.

---

## 5. Populate `ALLOWED_IMPL_CODE_HASHES` (audit CRIT-5)

`lib/aa/eip7702.ts` refuses to delegate EOAs to a Modular Account v2
implementation unless its `keccak256(getCode(impl))` is in the allowlist.
The set ships empty so a brand-new deploy refuses to delegate at all.

For testnet/dev:
```bash
# Acceptable to set NEXT_PUBLIC_TRUST_IMPL_BYTECODE=1 to bypass the gate.
```

For mainnet/prod:
```bash
# Compute the hash of the impl bytecode on the target chain.
cast keccak $(cast code 0x99999999B4ad8aa6d4666f23dab18d3D9C3B3eC7 \
  --rpc-url https://rpc.testnet.chain.robinhood.com)
# Add the resulting 0x... to ALLOWED_IMPL_CODE_HASHES in eip7702.ts.
```

Re-run after any Alchemy MAv2 implementation upgrade.

---

## 6. WalletConnect projectId domain lock

Public by design, but if not domain-locked any other site can use your
projectId for their app. Cosmetic risk but cheap to lock down:

cloud.walletconnect.com → your project → Settings → Allowed Origins.

---

## 7. Pre-launch checklist

Before promoting to mainnet, confirm:

- [ ] `.env.local` is empty in the repository working tree (no real keys).
- [ ] Production env vars are set via the platform dashboard, not files.
- [ ] `CRON_SECRET` is set and non-empty in production env.
- [ ] Vercel deploys with `NODE_ENV=production`.
- [ ] Pre-commit hook scans for `0x[0-9a-f]{64}` in env files
      (see `.husky/pre-commit` or set up via `git secret-scan`).
- [ ] Alchemy app + paymaster policy locked to production domain.
- [ ] Upstash domain allowlist set.
- [ ] `ALLOWED_IMPL_CODE_HASHES` populated in `lib/aa/eip7702.ts`.
- [ ] `NEXT_PUBLIC_TRUST_IMPL_BYTECODE` NOT set in prod.
- [ ] Adapter `maxDeviationBps` confirmed at 500 (5%) on every deployed
      adapter (`cast call $ADAPTER "maxDeviationBps()"`).
- [ ] Vault `paused()` is false but pause role tested.
- [ ] Owner wallet of `EquiFlowVault` is a Gnosis Safe / multisig, NOT
      the single keeper EOA.
- [ ] Owner of every `PythPriceAdapter` is the same multisig.
- [ ] CI runs `forge test` on every PR and blocks merges on red.
- [ ] CI builds the Next.js app with strict TypeScript (`tsc --noEmit`).
- [ ] CSP header tested in Lighthouse (no inline-script violations).
- [ ] External penetration test completed (Spearbit / Trail of Bits /
      OpenZeppelin) — DO NOT launch to mainnet without one.

---

## 8. Incident response — keeper key compromise

If you suspect `KEEPER_PRIVATE_KEY` has leaked:

1. **Pause the vault**:
   ```bash
   cast send $VAULT "pause()" --private-key $OWNER_PK
   ```
2. **Revoke the keeper** on every adapter:
   ```bash
   cast send $ADAPTER "setKeeper(address,bool)" $COMPROMISED_KEEPER false
   ```
3. **Drain the compromised EOA** to prevent further updates.
4. Rotate per Section 1.
5. Unpause once new keeper is funded and authorised.

---

## 9. Audit-fix changelog (2026-05-28)

For traceability — see git history for full diffs.

| ID | File touched | Brief |
|---|---|---|
| CRIT-2 | `app/api/keeper/tick/route.ts` | Bearer auth + adapter allowlist + Hermes-only prices |
| CRIT-3 | `app/api/defender/{register,revoke}/route.ts` | EIP-712 signature verification |
| CRIT-4 | `lib/aa/session-store.ts`, `lib/aa/session-key.ts` | WebCrypto AES-GCM session-key encryption |
| CRIT-5 | `lib/aa/eip7702.ts` | In-memory tuple cache + impl bytecode-hash gate |
| CRIT-6 | `contracts/src/EquiFlowVault.sol` | Single-active-intent LP deposit |
| CRIT-7 | `contracts/src/EquiFlowVault.sol` | Pro-rata borrow attribution across collateral |
| CRIT-8 | `contracts/src/oracle/PythPriceAdapter.sol`, Deploy script | 5% deviation cap + 20% ceiling |
| CRIT-9 | `components/AutoDefenderModal.tsx` | BETA disclosure on on-chain-not-enforced |
| CRIT-10 | `app/api/keeper/cron/route.ts` | timing-safe + fail-closed in prod |
| CRIT-11 | `contracts/src/EquiFlowVault.sol` | `writeOffBadDebt` + `socializedBadDebtUsd` |
| H-1 | `contracts/src/EquiFlowVault.sol` | `_safePriceOrZero` in HF helpers |
| H-2 | `contracts/src/EquiFlowVault.sol` | `withdrawLiquidity` 24h timelock |
| H-3 | `contracts/src/EquiFlowVault.sol` | `listAsset` new-only + `updateAssetRiskParams` narrow-only |
| H-4 | `contracts/src/EquiFlowVault.sol` | confidence check on liquidate |
| H-5/H-6 | `lib/aa/{smart-account,eip7702}.ts` | chainId guard at every sign |
| H-7 | `lib/api/security.ts` + every route | `sanitizeError` |
| H-9 | `lib/api/security.ts` + every route | `fetchWithTimeout` |
| H-13 | `app/api/defender/register/route.ts` | weeklyLimit + collateralTokens caps |
| H-14 | `lib/web3/defender-store.ts` | atomic `INCRBY` |
| M-1 | `contracts/src/EquiFlowVault.sol` | `whenNotPaused` on `withdraw` |
| M-5 | next.config.ts | CSP + X-Frame + HSTS + Permissions-Policy |
| M-5 (sc) | `contracts/src/EquiFlowVault.sol` | balance-delta accounting |
| M-6 (sc) | `contracts/src/EquiFlowVault.sol` | liquidate respects disabled flag correctly |

77 Foundry tests pass post-fix; existing UI flows unchanged externally.
