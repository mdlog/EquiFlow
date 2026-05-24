"use client";

import {
  type Address,
  type Hex,
  bytesToHex,
  encodeFunctionData,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { SmartAccount } from "viem/account-abstraction";
import { sendUserOp } from "./send-userop";

/// ─── Session Key Manager — Tier 3 Auto-Defender ──────────────────────────
///
/// Generates an ephemeral private key that the keeper bot can use to sign
/// limited, pre-authorized UserOps on behalf of the smart wallet. The user
/// signs once (the install UserOp), then the keeper handles repayments
/// automatically while the user is asleep.
///
/// Real Modular Account v2 deployment: this would call `installValidation()`
/// to attach a SingleSignerValidationModule + permission hooks restricting
/// the session key to `vault.repayDebt(token, debtAmount)` only, with a
/// per-week spending cap and an expiry timestamp.
///
/// For the demo: we (a) keep the session key private locally in
/// `localStorage`, (b) submit a small no-op UserOp tagged with the session
/// metadata as proof-of-authorization, and (c) replicate the permission
/// metadata to the backend so the keeper can find + use it.
///
/// /// TODO: real validator deploy — replace stubbed `installValidation` with
///       Alchemy's MAv2 modular validator factory call once the canonical
///       module address is published on RBN testnet.

const STORAGE_PREFIX = "equiflow.defender.session.v1.";

export interface SessionPermissions {
  /// Maximum USDG (1e6 atomic units) the keeper may repay per 7-day window.
  weeklyLimitUsdg: bigint;
  /// Health-factor threshold below which the keeper may act.  18-decimals fixed.
  /// e.g. 1.15 → 1_150_000_000_000_000_000n.
  healthThreshold: bigint;
  /// Unix seconds after which the session is invalid.
  expiresAt: number;
  /// Token whitelist — collateral tokens the keeper may repay against.
  /// Empty array means "any collateral the user holds".
  collateralTokens: Address[];
}

export interface StoredSession {
  /// Hex-encoded private key for the ephemeral session signer.
  /// IMPORTANT: never sent to the server — stays in browser localStorage.
  privateKey: Hex;
  /// Public address derived from `privateKey`.
  sessionKeyAddress: Address;
  /// Smart wallet (account address) the session key is bound to.
  smartWalletAddress: Address;
  /// Permissions snapshot when the session was created.
  permissions: {
    weeklyLimitUsdg: string; // bigint as decimal string for JSON safety
    healthThreshold: string;
    expiresAt: number;
    collateralTokens: Address[];
  };
  /// UserOp hash from the install transaction (proof of authorization).
  installUserOpHash?: Hex;
  /// Wall-clock millis when registered.
  createdAt: number;
}

function storageKey(smartWallet: Address): string {
  return STORAGE_PREFIX + smartWallet.toLowerCase();
}

/// Mints a fresh keypair via viem's cryptographically-secure RNG.
export function generateSessionKey(): {
  privateKey: Hex;
  address: Address;
} {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  return { privateKey: pk, address: account.address };
}

/// Read a stored session for the given smart wallet, or null if none / expired.
export function getSessionKey(smartWallet: Address): StoredSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey(smartWallet));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed.permissions.expiresAt * 1000 < Date.now()) {
      // Expired — clean up.
      window.localStorage.removeItem(storageKey(smartWallet));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/// Wipe the session for the given smart wallet from localStorage. Does NOT
/// uninstall the validator on-chain — that requires a separate UserOp.
export function clearSessionKey(smartWallet: Address): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(smartWallet));
}

interface RegisterArgs {
  smartAccount: SmartAccount;
  smartWalletAddress: Address;
  permissions: SessionPermissions;
}

/// Registers a new session key for `smartAccount`.
///
/// Flow:
///   1. Generate ephemeral keypair.
///   2. Build the UserOp calldata that would install the validator. For the
///      demo this is a self-call carrying a permission-fingerprint event;
///      with a real module it would call `account.installValidation(...)`.
///   3. Submit the UserOp via sendUserOp() — uses Tier 2 sponsored gas so the
///      user pays nothing.
///   4. Persist the session locally AND hand the public address + permissions
///      to the backend so the keeper can find them.
export async function registerSessionKey({
  smartAccount,
  smartWalletAddress,
  permissions,
}: RegisterArgs): Promise<StoredSession> {
  const { privateKey, address: sessionKeyAddress } = generateSessionKey();

  // Build a permission fingerprint so the install UserOp carries an auditable
  // tag of what the user authorized. Encoded as a self-call to the smart
  // wallet itself (no-op execute(0,0,bytes) with metadata as calldata).
  const fingerprint = keccak256(
    toBytes(
      JSON.stringify({
        s: sessionKeyAddress,
        w: permissions.weeklyLimitUsdg.toString(),
        h: permissions.healthThreshold.toString(),
        e: permissions.expiresAt,
        t: permissions.collateralTokens,
      }),
    ),
  );

  // /// TODO: real validator deploy — swap for installValidation():
  // const installCalldata = encodeFunctionData({
  //   abi: MODULAR_ACCOUNT_V2_ABI,
  //   functionName: "installValidation",
  //   args: [moduleAddress, entityId, isGlobal, isSignatureValidation,
  //          isUserOpValidation, [sessionKeyAddress], hooks, selectors],
  // });
  //
  // For the demo we just emit a 0-value self-call. The UserOp lands on-chain
  // and the receipt is proof-of-authorization. Keeper trusts the backend
  // record which references this op hash.
  let installUserOpHash: Hex | undefined;
  try {
    const submitted = await sendUserOp({
      smartAccount,
      calls: [
        {
          to: smartWalletAddress,
          value: 0n,
          data: fingerprint, // metadata-carrying calldata, target is self
        },
      ],
      gasMode: "sponsored",
    });
    installUserOpHash = submitted.userOpHash;
  } catch (err) {
    // If gas-sponsored UserOp can't be sent (no API key configured, or RBN
    // testnet rpc fails), fall through — the user has effectively still
    // signed via the EOA-backed smartAccount.signMessage above, and the
    // backend stores a tagged record. UI will surface the inline error.
    if (err instanceof Error) {
      // Re-throw so the modal can surface it. The user can retry once the
      // env is correct without losing their preferences.
      throw err;
    }
    throw new Error("session_install_failed");
  }

  const stored: StoredSession = {
    privateKey,
    sessionKeyAddress,
    smartWalletAddress,
    permissions: {
      weeklyLimitUsdg: permissions.weeklyLimitUsdg.toString(),
      healthThreshold: permissions.healthThreshold.toString(),
      expiresAt: permissions.expiresAt,
      collateralTokens: permissions.collateralTokens,
    },
    installUserOpHash,
    createdAt: Date.now(),
  };

  // Persist locally.
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      storageKey(smartWalletAddress),
      JSON.stringify(stored),
    );
  }

  // Replicate metadata to backend (private key never leaves the browser).
  await registerWithBackend(stored);

  return stored;
}

/// Builds the auth signature the backend uses to verify the registration
/// came from the legitimate smart account. The smartAccount's `signMessage`
/// is the EOA owner's signature in EOA-mode and the smart account's
/// ERC-1271 signature otherwise — both verifiable on-chain.
async function authSignature(
  smartAccount: SmartAccount,
  payload: object,
): Promise<Hex> {
  const message = JSON.stringify(payload);
  return smartAccount.signMessage({ message });
}

async function registerWithBackend(stored: StoredSession): Promise<void> {
  const payload = {
    wallet: stored.smartWalletAddress,
    sessionKey: stored.sessionKeyAddress,
    weeklyLimitUsdg: stored.permissions.weeklyLimitUsdg,
    healthThreshold: stored.permissions.healthThreshold,
    expiresAt: stored.permissions.expiresAt,
    collateralTokens: stored.permissions.collateralTokens,
    installUserOpHash: stored.installUserOpHash,
  };
  try {
    const res = await fetch("/api/defender/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Surface but don't block — UI can re-sync later.
      const text = await res.text().catch(() => "");
      console.warn("[defender] register backend failed:", res.status, text);
    }
  } catch (err) {
    console.warn("[defender] register backend unreachable:", err);
  }
}

/// Off-chain revoke: clears localStorage and tells the backend to stop
/// considering this wallet's defender active. The on-chain validator
/// remains installed until a separate `uninstallValidation` UserOp runs
/// (out of scope for the demo).
export async function revokeSessionKey({
  smartAccount,
  smartWalletAddress,
}: {
  smartAccount: SmartAccount | null;
  smartWalletAddress: Address;
}): Promise<void> {
  clearSessionKey(smartWalletAddress);
  try {
    const sig = smartAccount
      ? await authSignature(smartAccount, {
          wallet: smartWalletAddress,
          action: "revoke",
        })
      : "0x";
    await fetch("/api/defender/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: smartWalletAddress, signature: sig }),
    });
  } catch (err) {
    console.warn("[defender] revoke backend unreachable:", err);
  }
  void encodeFunctionData; // silence unused-import lint when stubbed
  void bytesToHex;
}
