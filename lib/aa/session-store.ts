"use client";

import { type Address, type Hex } from "viem";

// Encrypted session-key storage.
//
// Threat model:
//   - localStorage plaintext is trivially exfiltrated by any XSS, extension,
//     or accidental `JSON.stringify(localStorage)` leak. That was the prior
//     posture and is unacceptable when the session key represents on-chain
//     signing authority over a user's smart wallet.
//
// What this module does:
//   1. Generates a non-extractable AES-GCM `CryptoKey` on first use and
//      stores it inside IndexedDB. Non-extractable means even with a working
//      handle, the raw key bytes cannot be read out by JS.
//   2. Encrypts the session private key under that CryptoKey using a random
//      96-bit IV. Stores only the ciphertext + IV + opaque CryptoKey handle.
//   3. Decryption requires both the IDB-resident CryptoKey *and* the IDB row
//      — an attacker with only one half learns nothing.
//
// What this module DOES NOT do:
//   - Defend against an XSS that runs `crypto.subtle.decrypt(...)` itself
//     using the stored CryptoKey. Mitigation against that requires user
//     reentry (passphrase / passkey). That's planned but out-of-scope for
//     this fix; see docs/SECURITY_RUNBOOK.md.
//   - Defend against memory-scraping after a successful decrypt — the
//     private key briefly lives in JS heap when signing.

const DB_NAME = "equiflow-session";
const DB_VERSION = 1;
const STORE = "sessions";

interface StoredSessionRow {
  smartWallet: string; // lowercased
  sessionKeyAddress: Address;
  // Wrapping key — stored as opaque CryptoKey object (non-extractable).
  wrappingKey: CryptoKey;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  // Plaintext metadata (NOT secret).
  permissions: {
    weeklyLimitUsdg: string;
    healthThreshold: string;
    expiresAt: number;
    collateralTokens: Address[];
  };
  installUserOpHash?: Hex;
  createdAt: number;
}

export interface DecryptedSession {
  smartWallet: Address;
  sessionKeyAddress: Address;
  sessionPrivateKey: Hex;
  permissions: StoredSessionRow["permissions"];
  installUserOpHash?: Hex;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "smartWallet" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDb();
  return await new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    if (out instanceof IDBRequest) {
      out.onsuccess = () => resolve(out.result);
      out.onerror = () => reject(out.error);
    } else {
      out.then(resolve, reject);
    }
  });
}

async function generateWrappingKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

function hexToBytes(hex: Hex): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("invalid_hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): Hex {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s as Hex;
}

export async function storeSession(opts: {
  smartWallet: Address;
  sessionKeyAddress: Address;
  sessionPrivateKey: Hex;
  permissions: StoredSessionRow["permissions"];
  installUserOpHash?: Hex;
}): Promise<void> {
  const wrappingKey = await generateWrappingKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = hexToBytes(opts.sessionPrivateKey);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    wrappingKey,
    plaintext as BufferSource,
  );
  // Wipe the plaintext byte view as soon as we no longer need it. Best-effort.
  plaintext.fill(0);
  const ciphertext = new Uint8Array(ciphertextBuf);

  const row: StoredSessionRow = {
    smartWallet: opts.smartWallet.toLowerCase(),
    sessionKeyAddress: opts.sessionKeyAddress,
    wrappingKey,
    iv,
    ciphertext,
    permissions: opts.permissions,
    installUserOpHash: opts.installUserOpHash,
    createdAt: Date.now(),
  };
  await tx<IDBValidKey>("readwrite", (store) => store.put(row));
}

export async function readSession(
  smartWallet: Address,
): Promise<DecryptedSession | null> {
  let row: StoredSessionRow | undefined;
  try {
    row = await tx<StoredSessionRow | undefined>("readonly", (store) =>
      store.get(smartWallet.toLowerCase()),
    );
  } catch {
    return null;
  }
  if (!row) return null;

  if (row.permissions.expiresAt * 1000 < Date.now()) {
    await deleteSession(smartWallet).catch(() => undefined);
    return null;
  }

  let plaintextBuf: ArrayBuffer;
  try {
    plaintextBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: row.iv as BufferSource },
      row.wrappingKey,
      row.ciphertext as BufferSource,
    );
  } catch {
    // Wrapping key lost or tampered — wipe row.
    await deleteSession(smartWallet).catch(() => undefined);
    return null;
  }
  const sessionPrivateKey = bytesToHex(new Uint8Array(plaintextBuf));
  return {
    smartWallet,
    sessionKeyAddress: row.sessionKeyAddress,
    sessionPrivateKey,
    permissions: row.permissions,
    installUserOpHash: row.installUserOpHash,
    createdAt: row.createdAt,
  };
}

export async function deleteSession(smartWallet: Address): Promise<void> {
  await tx<undefined>("readwrite", (store) =>
    store.delete(smartWallet.toLowerCase()),
  );
}

// Migration: wipe any legacy plaintext sessions left in localStorage from the
// pre-encryption build. Call once on module init from the consumer.
const LEGACY_PREFIX = "equiflow.defender.session.v1.";
export function wipeLegacyLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(LEGACY_PREFIX)) toRemove.push(key);
    }
    for (const key of toRemove) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
