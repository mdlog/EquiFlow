"use client";

import {
  type Address,
  type Hex,
  encodePacked,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { SmartAccount } from "viem/account-abstraction";
import { sendUserOp } from "./send-userop";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { EQUIFLOW_VAULT_ADDRESS } from "@/lib/contracts";
import {
  storeSession,
  readSession,
  deleteSession,
  wipeLegacyLocalStorage,
  type DecryptedSession,
} from "./session-store";

// ─── Session Key Manager — Tier 3 Auto-Defender ─────────────────────────
//
// Generates an ephemeral private key for the keeper bot to sign limited,
// pre-authorized UserOps on behalf of the smart wallet. Private keys are
// encrypted at rest (see session-store.ts) and the install / revoke
// requests carry an EIP-712 signature that the backend verifies before
// trusting the registration.
//
// IMPORTANT (matches CRIT-9 in security audit): the install UserOp this
// module emits is currently a no-op self-call. Until the on-chain
// `installValidation()` path ships against a published Modular Account v2
// validator, the keeper sweep stays in `dry_run` server-side — the limits
// are off-chain. The UI banner makes this explicit.

// Run on module load (browser). Clears any leftover plaintext sessions
// from the prior insecure implementation.
if (typeof window !== "undefined") {
  wipeLegacyLocalStorage();
}

export interface SessionPermissions {
  weeklyLimitUsdg: bigint;
  healthThreshold: bigint;
  expiresAt: number;
  collateralTokens: Address[];
}

export interface StoredSession {
  privateKey: Hex;
  sessionKeyAddress: Address;
  smartWalletAddress: Address;
  permissions: {
    weeklyLimitUsdg: string;
    healthThreshold: string;
    expiresAt: number;
    collateralTokens: Address[];
  };
  installUserOpHash?: Hex;
  createdAt: number;
}

export function generateSessionKey(): { privateKey: Hex; address: Address } {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  return { privateKey: pk, address: account.address };
}

export async function getSessionKey(
  smartWallet: Address,
): Promise<StoredSession | null> {
  const dec = await readSession(smartWallet);
  if (!dec) return null;
  return decryptedToStored(dec);
}

export async function clearSessionKey(smartWallet: Address): Promise<void> {
  await deleteSession(smartWallet);
}

function decryptedToStored(d: DecryptedSession): StoredSession {
  return {
    privateKey: d.sessionPrivateKey,
    sessionKeyAddress: d.sessionKeyAddress,
    smartWalletAddress: d.smartWallet,
    permissions: d.permissions,
    installUserOpHash: d.installUserOpHash,
    createdAt: d.createdAt,
  };
}

// ─── EIP-712 helpers (mirror lib/api/security.ts) ───────────────────────

const DEFENDER_REGISTER_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  DefenderRegister: [
    { name: "wallet", type: "address" },
    { name: "sessionKey", type: "address" },
    { name: "weeklyLimitUsdg", type: "uint256" },
    { name: "healthThreshold", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "collateralTokensHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const DEFENDER_REVOKE_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  DefenderRevoke: [
    { name: "wallet", type: "address" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

function collateralTokensHash(addrs: Address[]): Hex {
  if (addrs.length === 0) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  const sorted = [...addrs].map((a) => a.toLowerCase() as Address).sort();
  return keccak256(
    encodePacked(
      sorted.map(() => "address" as const),
      sorted,
    ),
  );
}

function randomNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s as Hex;
}

function defenderDomain() {
  if (!EQUIFLOW_VAULT_ADDRESS) {
    throw new Error("vault_not_configured");
  }
  return {
    name: "EquiFlow Defender",
    version: "1",
    chainId: BigInt(ROBINHOOD_CHAIN_TESTNET_ID),
    verifyingContract: EQUIFLOW_VAULT_ADDRESS,
  };
}

// ─── Register ───────────────────────────────────────────────────────────

interface RegisterArgs {
  smartAccount: SmartAccount;
  smartWalletAddress: Address;
  permissions: SessionPermissions;
}

export async function registerSessionKey({
  smartAccount,
  smartWalletAddress,
  permissions,
}: RegisterArgs): Promise<StoredSession> {
  if (!EQUIFLOW_VAULT_ADDRESS) {
    throw new Error("Vault address is not configured; cannot register session key.");
  }

  const { privateKey, address: sessionKeyAddress } = generateSessionKey();

  // Permission fingerprint for the on-chain self-call calldata. Keeps the
  // install op observable as something distinct from random self-noise.
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

  let installUserOpHash: Hex | undefined;
  try {
    const submitted = await sendUserOp({
      smartAccount,
      calls: [
        {
          to: smartWalletAddress,
          value: 0n,
          data: fingerprint,
        },
      ],
      gasMode: "sponsored",
    });
    installUserOpHash = submitted.userOpHash;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("session_install_failed");
  }

  // Build EIP-712 message and sign via the smart account (ERC-1271 on chain).
  const nonce = randomNonce();
  const tokensHash = collateralTokensHash(permissions.collateralTokens);
  const message = {
    wallet: smartWalletAddress,
    sessionKey: sessionKeyAddress,
    weeklyLimitUsdg: permissions.weeklyLimitUsdg,
    healthThreshold: permissions.healthThreshold,
    expiresAt: BigInt(permissions.expiresAt),
    collateralTokensHash: tokensHash,
    nonce: BigInt(nonce),
  } as const;

  const signature = await smartAccount.signTypedData({
    domain: defenderDomain(),
    types: DEFENDER_REGISTER_TYPES,
    primaryType: "DefenderRegister",
    message,
  });

  // Persist locally (encrypted at rest).
  await storeSession({
    smartWallet: smartWalletAddress,
    sessionKeyAddress,
    sessionPrivateKey: privateKey,
    permissions: {
      weeklyLimitUsdg: permissions.weeklyLimitUsdg.toString(),
      healthThreshold: permissions.healthThreshold.toString(),
      expiresAt: permissions.expiresAt,
      collateralTokens: permissions.collateralTokens,
    },
    installUserOpHash,
  });

  // Replicate signed payload to backend. The server independently verifies
  // the signature; an attacker forging this request gets a 401.
  await registerWithBackend({
    wallet: smartWalletAddress,
    sessionKey: sessionKeyAddress,
    weeklyLimitUsdg: permissions.weeklyLimitUsdg.toString(),
    healthThreshold: permissions.healthThreshold.toString(),
    expiresAt: permissions.expiresAt,
    collateralTokens: permissions.collateralTokens,
    nonce,
    signature,
    installUserOpHash,
  });

  return {
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
}

interface RegisterBackendBody {
  wallet: Address;
  sessionKey: Address;
  weeklyLimitUsdg: string;
  healthThreshold: string;
  expiresAt: number;
  collateralTokens: Address[];
  nonce: Hex;
  signature: Hex;
  installUserOpHash?: Hex;
}

async function registerWithBackend(payload: RegisterBackendBody): Promise<void> {
  const res = await fetch("/api/defender/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`register_backend_${res.status}_${text.slice(0, 80)}`);
  }
}

// ─── Revoke ─────────────────────────────────────────────────────────────

export async function revokeSessionKey({
  smartAccount,
  smartWalletAddress,
}: {
  smartAccount: SmartAccount | null;
  smartWalletAddress: Address;
}): Promise<void> {
  // Always clear the local encrypted record — even if backend revoke fails
  // we want the key gone from this device.
  await clearSessionKey(smartWalletAddress);

  if (!smartAccount) return; // Best-effort: no signer means we can't tell the
  // backend authoritatively. The backend will eventually expire the entry,
  // but operators should clear it from the dashboard meanwhile.

  if (!EQUIFLOW_VAULT_ADDRESS) return;

  const nonce = randomNonce();
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10-minute signature lifetime
  const signature = await smartAccount.signTypedData({
    domain: defenderDomain(),
    types: DEFENDER_REVOKE_TYPES,
    primaryType: "DefenderRevoke",
    message: {
      wallet: smartWalletAddress,
      expiresAt: BigInt(expiresAt),
      nonce: BigInt(nonce),
    },
  });

  const res = await fetch("/api/defender/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: smartWalletAddress,
      expiresAt,
      nonce,
      signature,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[defender] revoke backend failed:", res.status, text);
  }
}
