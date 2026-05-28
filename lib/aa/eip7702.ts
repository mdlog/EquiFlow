"use client";

import type { Address, Hex, SignedAuthorization, WalletClient } from "viem";
import { keccak256, numberToHex } from "viem";
import { MODULAR_ACCOUNT_V2_IMPL } from "@/lib/web3/alchemy";
import { getPublicClient } from "./bundler";
import { isEoaDelegated } from "./smart-account";

// Bytecode-hash allowlist for the Modular Account v2 implementation.
//
// Why this exists: MODULAR_ACCOUNT_V2_IMPL is sourced from NEXT_PUBLIC_* env
// vars and ultimately from a build-time config. A compromised Vercel env or
// a typo-d address would silently delegate every user's EOA to attacker
// bytecode. By keccak256-hashing the impl bytecode at runtime and gating
// delegation behind a known-good hash list, we make that pivot impossible
// without code-review of this file.
//
// Operators MUST populate `ALLOWED_IMPL_CODE_HASHES` after deploying or
// verifying the Modular Account v2 impl on RBN. Until then, the gate is
// configurable via `NEXT_PUBLIC_TRUST_IMPL_BYTECODE=1` for dev/testnet.
//
// To add a hash: `cast keccak (cast code <impl>)` and paste below.
const ALLOWED_IMPL_CODE_HASHES: ReadonlySet<Hex> = new Set<Hex>([
  // populate with verified hashes once published — empty by default
]);

class EipImplHashMismatchError extends Error {
  constructor(public actualHash: Hex) {
    super(
      `EIP-7702 delegation aborted: implementation bytecode hash ${actualHash} ` +
        "is not in the verified allowlist. Refusing to delegate the EOA. " +
        "See lib/aa/eip7702.ts → ALLOWED_IMPL_CODE_HASHES.",
    );
    this.name = "EipImplHashMismatchError";
  }
}

async function ensureImplBytecodeAllowed(impl: Address): Promise<void> {
  const trustEnv = process.env.NEXT_PUBLIC_TRUST_IMPL_BYTECODE;
  const publicClient = getPublicClient();
  const code = await publicClient.getCode({ address: impl });
  if (!code || code === "0x") {
    throw new Error(
      `EIP-7702 delegation aborted: no bytecode at impl ${impl}. ` +
        "Did you point NEXT_PUBLIC_MODULAR_ACCOUNT_V2_IMPL at a real contract?",
    );
  }
  const hash = keccak256(code) as Hex;
  if (ALLOWED_IMPL_CODE_HASHES.has(hash)) return;
  if (trustEnv === "1") {
    console.warn(
      "[7702] WARNING: trusting unverified impl bytecode hash (NEXT_PUBLIC_TRUST_IMPL_BYTECODE=1):",
      hash,
    );
    return;
  }
  throw new EipImplHashMismatchError(hash);
}

/// ─── EIP-7702 Authorization Helpers ──────────────────────────────────────
///
/// EIP-7702 lets a regular EOA temporarily run code from a chosen smart
/// contract implementation, without changing the EOA's address. Mechanically
/// the user signs an "authorization tuple" (chainId, contractAddress, nonce)
/// — when a transaction containing that tuple is mined, the EOA's account
/// is patched to dispatch all subsequent calls through the implementation.
///
/// In EquiFlow's "eip7702" wallet mode, we delegate the user's EOA to
/// Modular Account v2 so the SAME ADDRESS picks up batched-call + UserOp
/// support. Tokens already held by the EOA become spendable by the smart
/// wallet automatically (no transfer step required).
///
/// Flow we implement:
///   1. User picks "Upgrade EOA (7702)" in WalletButton
///   2. UI calls `ensureDelegation(walletClient, eoaAddress)` before the
///      first UserOp
///   3. If `isEoaDelegated` already returns true → noop
///   4. Otherwise the user signs the auth tuple → it's attached to the next
///      UserOp via `eip7702Auth` (handled in send-userop.ts)

/// Thrown when the connected wallet can't sign an EIP-7702 authorization
/// tuple AND no on-chain confirmation callback was provided (or the user
/// declined the on-chain fallback). As of writing, no major browser wallet
/// — MetaMask, Rabby, Coinbase — exposes standalone `wallet_signAuthorization`
/// for third-party contracts:
///   - MetaMask restricts it to MetaMask's own contracts
///   - Rabby only integrates 7702 via `eth_sendTransaction` type 0x4
/// So the sponsored UserOp path is broken for browser wallets; the only
/// working path is a one-time on-chain type-4 tx. The hook layer asks the
/// user to approve that explicitly before submitting it.
export class Eip7702NotSupportedByWalletError extends Error {
  constructor() {
    super(
      "Your wallet doesn't support sponsored EIP-7702 delegation, and no " +
        "on-chain fallback was approved. Switch to factory-mode smart wallet, " +
        "or accept the one-time on-chain delegation tx when prompted.",
    );
    this.name = "Eip7702NotSupportedByWalletError";
  }
}

/// Thrown when the user cancels the one-time on-chain delegation confirmation
/// (the `window.confirm` dialog that explains the small ETH gas cost). Distinct
/// from Eip7702NotSupportedByWalletError so the UI can surface a friendly
/// "cancelled" message instead of "wallet not supported".
export class Eip7702DelegationCancelledError extends Error {
  constructor() {
    super(
      "On-chain EIP-7702 delegation cancelled. Choose factory-mode in the " +
        "wallet menu if you don't want to spend ETH gas for the one-time " +
        "delegation.",
    );
    this.name = "Eip7702DelegationCancelledError";
  }
}

/// Optional callback signature consumed by `ensureDelegation` when standalone
/// signing fails. The hook layer passes a `window.confirm`-backed implementation
/// that explains the one-time gas cost; returning `true` triggers the type-4
/// on-chain delegation, `false` aborts with `Eip7702DelegationCancelledError`.
export type ConfirmOnchainDelegation = () => Promise<boolean>;

// Auth tuples used to be persisted in localStorage so the next UserOp could
// pick them up after a page refresh. That made the *signed authorization*
// (which an attacker can submit on the user's behalf to delegate the EOA)
// trivially exfiltratable via any XSS. We now keep them in module memory
// only — refresh = re-prompt, but stolen tuples are not a thing.

export interface PendingAuth {
  owner: Address;
  tuple: SignedAuthorization;
  signedAt: number;
}

const inMemoryAuths = new Map<string, PendingAuth>();

export function readPendingAuth(owner: Address): PendingAuth | null {
  const cached = inMemoryAuths.get(owner.toLowerCase());
  if (!cached) return null;
  // 5-minute lifetime — short enough that stale nonces are unlikely,
  // long enough to cover the round-trip from signing to UserOp submission.
  if (Date.now() - cached.signedAt > 5 * 60 * 1000) {
    inMemoryAuths.delete(owner.toLowerCase());
    return null;
  }
  return cached;
}

export function clearPendingAuth() {
  inMemoryAuths.clear();
}

function writePendingAuth(p: PendingAuth) {
  inMemoryAuths.set(p.owner.toLowerCase(), p);
}

// One-time migration: wipe any old localStorage tuples left from the prior
// persistent implementation.
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem("equiflow.aa.pendingAuth.v1");
  } catch {
    // ignore
  }
}

/// Asks the user to sign a 7702 authorization tuple delegating their EOA to
/// the Modular Account v2 implementation. Stores the result in localStorage
/// so the next UserOp can pick it up.
///
/// If the wallet refuses standalone signing AND `onNeedOnchainConfirm` is
/// provided, asks the user (via callback) whether to fall back to an on-chain
/// type-4 SetCode tx. Returns `null` after a successful on-chain delegation
/// (subsequent UserOps won't need an authorization tuple attached).
///
/// Returns the signed tuple, `null` if already delegated, or `null` after
/// on-chain delegation completes. Throws on cancellation / unsupported wallet.
export async function ensureDelegation(
  walletClient: WalletClient,
  owner: Address,
  onNeedOnchainConfirm?: ConfirmOnchainDelegation,
): Promise<PendingAuth | null> {
  if (await isEoaDelegated(owner)) {
    clearPendingAuth();
    return null;
  }

  const cached = readPendingAuth(owner);
  if (cached) return cached;

  // Pin: refuse to delegate if the impl bytecode hash isn't in the allowlist.
  await ensureImplBytecodeAllowed(MODULAR_ACCOUNT_V2_IMPL);

  const publicClient = getPublicClient();
  // Prefer the wallet's nonce view (Rabby et al track pending txs locally,
  // so their count is fresher than the public RPC's by 1-2 txs).
  let nonce: number;
  const provider = getInjectedProvider();
  if (provider) {
    try {
      const hex = (await provider.request({
        method: "eth_getTransactionCount",
        params: [owner, "pending"],
      })) as Hex;
      nonce = parseInt(hex.replace(/^0x/, ""), 16);
    } catch {
      nonce = await publicClient.getTransactionCount({ address: owner });
    }
  } else {
    nonce = await publicClient.getTransactionCount({ address: owner });
  }

  // viem's wallet client supports signAuthorization as of 2.x via the
  // built-in account methods. We call through walletClient so the user's
  // injected wallet (MetaMask, etc.) handles the UX of the signature
  // request — MetaMask shows a dedicated "Delegate account" prompt in
  // versions that support EIP-7702 natively.
  const chainId = publicClient.chain?.id ?? 0;
  let signed: SignedAuthorization;
  try {
    signed = await (
      walletClient as WalletClient & {
        signAuthorization: (args: {
          account: Address;
          contractAddress: Address;
          chainId: number;
          nonce: number;
        }) => Promise<SignedAuthorization>;
      }
    ).signAuthorization({
      account: owner,
      contractAddress: MODULAR_ACCOUNT_V2_IMPL,
      chainId,
      nonce,
    });
  } catch (err) {
    // viem rejects `signAuthorization` for JsonRpcAccount type before even
    // talking to the provider. Wallets like Rabby DO implement the
    // `wallet_signAuthorization` RPC method, so we bypass viem and call the
    // provider directly. If THAT also fails, surface the friendly error.
    const msg = (err as Error).message ?? "";
    const viemTypeReject =
      msg.includes("AccountTypeNotSupportedError") ||
      msg.includes("json-rpc") ||
      msg.includes("signAuthorization Action does not support");

    if (!viemTypeReject) throw err;

    try {
      signed = await rawWalletSignAuthorization(walletClient, {
        account: owner,
        contractAddress: MODULAR_ACCOUNT_V2_IMPL,
        chainId,
        nonce,
      });
    } catch (rpcErr) {
      // Standalone signing rejected by wallet. As of 2026 no major browser
      // wallet exposes this for third-party contracts, so we expect this path
      // to be the norm rather than the exception for Rabby/MetaMask users.
      // Offer the on-chain type-4 fallback explicitly — if the hook provided
      // a confirmation callback, ask the user; otherwise surface the
      // unsupported error.
      console.warn("[7702] Standalone signing rejected by wallet:", rpcErr);
      if (!onNeedOnchainConfirm) {
        throw new Eip7702NotSupportedByWalletError();
      }
      const userAccepted = await onNeedOnchainConfirm();
      if (!userAccepted) {
        throw new Eip7702DelegationCancelledError();
      }
      await sendType4DelegationTx(owner, {
        contractAddress: MODULAR_ACCOUNT_V2_IMPL,
        chainId,
        nonce,
      });
      // Delegation now on-chain → subsequent UserOps see isEoaDelegated()
      // === true and skip the eip7702Auth field entirely. No tuple to cache.
      clearPendingAuth();
      return null;
    }
  }

  const result: PendingAuth = {
    owner,
    tuple: signed,
    signedAt: Date.now(),
  };
  writePendingAuth(result);
  return result;
}

/// Call the injected provider's `wallet_signAuthorization` RPC method
/// directly, bypassing viem's account-type gate. Used as fallback when viem
/// rejects the call for JsonRpcAccount.
///
/// Different wallets have slightly different shapes for both the request and
/// the response. We try the most common variants in order:
///   1. `wallet_signAuthorization` — Rabby's current beta
///   2. `eth_signAuthorization`    — proposed standard (some providers alias)
///
/// On success we return the SignedAuthorization tuple in the same shape viem
/// expects (so it slots into the UserOp's `authorization` field unchanged).
async function rawWalletSignAuthorization(
  _walletClient: WalletClient,
  args: {
    account: Address;
    contractAddress: Address;
    chainId: number;
    nonce: number;
  },
): Promise<SignedAuthorization> {
  // viem's `walletClient.request` actually routes through the HTTP transport
  // (RPC node) for non-canonical methods — not to the injected wallet. So we
  // skip viem entirely and talk to the EIP-1193 provider (window.ethereum)
  // directly, which is where Rabby/MetaMask/etc actually listen.
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("No injected EIP-1193 provider (window.ethereum) found");
  }

  const params = [
    {
      chainId: numberToHex(args.chainId),
      address: args.contractAddress,
      nonce: numberToHex(args.nonce),
    },
  ];

  // Try variant names in order. Each wallet has chosen a slightly different
  // spelling because there's no formal EIP for the sign step yet.
  const methods = [
    "wallet_signAuthorization",
    "eth_signAuthorization",
    "wallet_signSetCode",
  ] as const;

  const errs: Record<string, string> = {};
  for (const method of methods) {
    try {
      const raw = (await provider.request({
        method,
        params,
      })) as RawSignAuthResult;
      return normalizeSignedAuthorization(raw, args);
    } catch (err) {
      errs[method] = serializeRpcError(err);
    }
  }

  // Log structured errors first — DevTools "Inspect" lets you drill into
  // the live objects (helpful when fields like `data.code` matter).
  console.warn("[7702] wallet sign-authorization attempt outcomes:", errs);

  const detail = Object.entries(errs)
    .map(([m, e]) => `  ${m} → ${e.slice(0, 200)}`)
    .join("\n");
  throw new Error(
    `All wallet sign-authorization variants rejected:\n${detail}`,
  );
}

/// EIP-1193 providers throw errors that look like `{ code, message, data }`
/// rather than proper Error instances. `String(err)` on those returns the
/// useless "[object Object]". This serializer extracts the bits we actually
/// want for debugging.
function serializeRpcError(err: unknown): string {
  if (err == null) return "null";
  if (typeof err === "string") return err;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "object") {
    const e = err as { code?: number; message?: string; data?: unknown };
    const parts: string[] = [];
    if (e.code !== undefined) parts.push(`code=${e.code}`);
    if (e.message) parts.push(`"${e.message}"`);
    if (e.data !== undefined) parts.push(`data=${JSON.stringify(e.data)}`);
    if (parts.length === 0) {
      try {
        return JSON.stringify(err);
      } catch {
        return "[unserializable error object]";
      }
    }
    return parts.join(" ");
  }
  return String(err);
}

interface InjectedProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isRabby?: boolean;
  isMetaMask?: boolean;
  providers?: InjectedProvider[];
}

/// Submit a type-4 (SetCode) transaction with an unsigned authorization list.
/// The wallet (Rabby is the main supporter as of 2026) signs both the tx AND
/// the inner authorization tuple in one prompt, then submits it. The user
/// pays native gas for this single tx — afterwards the EOA is permanently
/// delegated and every subsequent UserOp can be sponsored.
///
/// This is called ONLY after the user explicitly confirms the one-time gas
/// cost via the `onNeedOnchainConfirm` callback in `ensureDelegation` — we
/// don't want surprise ETH charges for a flow advertised as "sponsored".
async function sendType4DelegationTx(
  owner: Address,
  args: {
    contractAddress: Address;
    chainId: number;
    nonce: number;
  },
): Promise<void> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected provider");

  // Verify the provider is actually on the target chain. Stops type-4 txs
  // from being submitted on mainnet if a user has mid-flight switched
  // networks. The inner authorization tuple is signed for `args.chainId`
  // (replay-safe on its own) but the outer tx must land on the right chain.
  try {
    const providerChainHex = (await provider.request({
      method: "eth_chainId",
    })) as Hex;
    const providerChainId = parseInt(providerChainHex.replace(/^0x/, ""), 16);
    if (providerChainId !== args.chainId) {
      throw new Error(
        `Wallet is on chain ${providerChainId}, expected ${args.chainId}. ` +
          "Switch to Robinhood Chain Testnet before delegating.",
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Wallet is on chain"))
      throw err;
    // If eth_chainId fails entirely, treat as unsupported.
    throw new Error("Could not verify wallet chain before delegation");
  }

  const txParams = {
    from: owner,
    to: owner, // self-call (noop) — only the authorization matters
    value: "0x0",
    data: "0x" as Hex,
    type: "0x4", // EIP-7702 set-code tx
    authorizationList: [
      {
        chainId: numberToHex(args.chainId),
        address: args.contractAddress,
        nonce: numberToHex(args.nonce),
        // No r/s/v/yParity — wallet fills these in during signing
      },
    ],
  };

  let txHash: Hex;
  try {
    txHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [txParams],
    })) as Hex;
  } catch (err) {
    throw new Error(
      `eth_sendTransaction (type 4) rejected: ${serializeRpcError(err)}`,
    );
  }

  console.info("[7702] Delegation tx submitted:", txHash);

  // Poll up to ~20s for the delegation to land. RBN block time ~0.25s, so
  // this should resolve in a few blocks. We don't fetch the receipt itself
  // because some providers strip tx fields — checking the bytecode at the
  // EOA is the canonical "is it delegated yet" signal.
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isEoaDelegated(owner)) {
      console.info("[7702] EOA delegation confirmed on-chain");
      return;
    }
  }
  throw new Error(
    `Delegation tx ${txHash} not yet confirmed after 20s — check explorer`,
  );
}

/// Resolve the active EIP-1193 provider. When multiple wallets are installed
/// they all jostle for `window.ethereum`; some expose a `.providers` array
/// for picking by capability. We prefer Rabby first because (as of 2026) it's
/// the only mainstream wallet with documented EIP-7702 signing support.
function getInjectedProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: InjectedProvider }).ethereum;
  if (!eth) return null;

  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const rabby = eth.providers.find((p) => p.isRabby);
    if (rabby) return rabby;
    return eth.providers[0];
  }
  return eth;
}

/// Wallets return the signed authorization in slightly different formats.
/// Normalize to viem's `SignedAuthorization` shape.
type RawSignAuthResult =
  | Hex // packed 65-byte signature; we still need to attach the tuple fields
  | {
      chainId?: Hex | number;
      address?: Address;
      nonce?: Hex | number;
      r?: Hex;
      s?: Hex;
      v?: Hex | number;
      yParity?: number;
    };

function normalizeSignedAuthorization(
  raw: RawSignAuthResult,
  args: {
    contractAddress: Address;
    chainId: number;
    nonce: number;
  },
): SignedAuthorization {
  // Variant 1: packed 65-byte hex string (r || s || v).
  if (typeof raw === "string") {
    const sig = raw.toLowerCase().replace(/^0x/, "");
    if (sig.length !== 130) {
      throw new Error(
        `expected 65-byte signature, got ${sig.length / 2} bytes`,
      );
    }
    const r = ("0x" + sig.slice(0, 64)) as Hex;
    const s = ("0x" + sig.slice(64, 128)) as Hex;
    const vByte = parseInt(sig.slice(128, 130), 16);
    const yParity = vByte >= 27 ? vByte - 27 : vByte;
    return {
      chainId: args.chainId,
      address: args.contractAddress,
      nonce: args.nonce,
      r,
      s,
      yParity: yParity as 0 | 1,
    };
  }

  // Variant 2: structured object with r, s, yParity (or v).
  if (!raw.r || !raw.s) {
    throw new Error("missing r/s in wallet response");
  }
  const yParity =
    raw.yParity !== undefined
      ? raw.yParity
      : raw.v !== undefined
        ? typeof raw.v === "number"
          ? raw.v >= 27
            ? raw.v - 27
            : raw.v
          : parseInt(raw.v, 16) >= 27
            ? parseInt(raw.v, 16) - 27
            : parseInt(raw.v, 16)
        : 0;

  return {
    chainId: args.chainId,
    address: raw.address ?? args.contractAddress,
    nonce: args.nonce,
    r: raw.r,
    s: raw.s,
    yParity: (yParity & 1) as 0 | 1,
  };
}
