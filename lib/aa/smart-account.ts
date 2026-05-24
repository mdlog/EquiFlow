"use client";

import {
  type Address,
  type Hex,
  type WalletClient,
  encodeFunctionData,
} from "viem";
import {
  type SmartAccount,
  type UserOperation,
  getUserOperationHash,
  toSmartAccount,
} from "viem/account-abstraction";
import {
  ENTRY_POINT_07,
  MODULAR_ACCOUNT_V2_FACTORY,
  MODULAR_ACCOUNT_V2_IMPL,
  MODULAR_ACCOUNT_V2_SALT,
} from "@/lib/web3/alchemy";
import { ROBINHOOD_CHAIN_TESTNET_ID as robinhoodChainTestnetId } from "@/lib/config/chain";
import { getPublicClient } from "./bundler";

/// Minimal ABI for Alchemy's Modular Account v2 factory.
///
/// Two deploy paths exist on this factory: the full ModularAccount (proxy)
/// via `createAccount(owner, salt, entityId)`, and the SemiModularAccount
/// (bytecode-based, cheaper to deploy) via `createSemiModularAccount(owner,
/// salt)`. Alchemy's own SDK defaults to SemiModular for non-7702 flows
/// because the bytecode variant skips proxy overhead. Verified on RBN
/// testnet — both selectors present in the factory bytecode.
const MODULAR_ACCOUNT_V2_FACTORY_ABI = [
  {
    type: "function",
    name: "getAddressSemiModular",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "createSemiModularAccount",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "nonpayable",
  },
] as const;

/// Modular Account v2 stub signature for gas estimation.
///
/// Format (66 bytes total): `[1 byte SignatureType.EOA = 0x00] [r=32B][s=32B][v=1B]`.
/// The bundler simulates `validateUserOp` with this stub before the owner
/// signs the real hash, so it must decode cleanly: SemiModular slices the
/// first byte as the signature type, then `ECDSA.tryRecover` on the
/// remaining 65 bytes. A short stub (missing `v`) returns AA23 during
/// estimation, leaving all gas fields at 0.
/// Modular Account v2 nonce-key encoding for the SemiModular fallback signer.
///
/// `ValidationLocatorLib.packNonce` lays the key out as `(entityId << 8) | flags`,
/// where flag bit 0 is `_VALIDATION_TYPE_GLOBAL`. Two checks happen during
/// `_validateUserOp`:
///   1. `_checkIfValidationAppliesCallData(...)` runs in `SELECTOR` mode
///      unless `isGlobal()` is true — selector mode reverts for lookupKey=0
///      because the fallback signer has no registered selectors.
///   2. `_execUserOpValidation` dispatches to fallback only when
///      `lookupKey == FALLBACK_VALIDATION_LOOKUP_KEY (0)`.
///
/// `lookupKey()` masks the locator with `& 0xFFFF...04`, clearing bit 0 (the
/// global flag) — so a locator of `1` produces lookupKey `0`. Setting key=1
/// satisfies both conditions: `isGlobal=true` (global check mode) AND
/// `lookupKey=0` (fallback dispatch). viem's default `nonceKeyManager` picks
/// random keys for parallel UserOps; we override here.
const MODULAR_ACCOUNT_V2_NONCE_KEY = 1n;

/// Minimal EntryPoint v0.7 ABI — only the `getNonce` view we need to track
/// the per-(account, key) sequence after the smart wallet's first UserOp.
const ENTRY_POINT_GET_NONCE_ABI = [
  {
    type: "function",
    name: "getNonce",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ name: "nonce", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/// Modular Account v2 stub signature for gas estimation. 67 bytes total:
/// `[0xFF = RESERVED_VALIDATION_DATA_INDEX] + [0x00 = SignatureType.EOA] +
/// [r=32B] + [s=32B, max valid] + [v=0x1c]`.
///
/// The leading `0xFF` is `RESERVED_VALIDATION_DATA_INDEX`, the segment marker
/// `SparseCalldataSegmentLib.getFinalSegment` checks. Without it,
/// `_doUserOpValidation` reverts with `ValidationSignatureSegmentMissing` →
/// surfaced to the bundler as `AA23 reverted`. After it, the SemiModular
/// fallback path slices the SignatureType byte and runs `ECDSA.tryRecover`
/// on the remaining 65 bytes. OpenZeppelin's `tryRecover` enforces EIP-2
/// anti-malleability — `s` must be `≤ secp256k1n/2` — so we use exactly
/// that cap so the stub decodes cleanly but the recovered address won't
/// match the owner (returns `_SIG_VALIDATION_FAILED`, not a revert).
/// secp256k1 group order / 2 — the largest `s` that OpenZeppelin's ECDSA
/// library accepts (EIP-2 anti-malleability cap). 64 hex chars (32 bytes).
const SECP256K1_N_HALF =
  "7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0";

const MODULAR_ACCOUNT_V2_STUB_SIGNATURE = ("0xFF" + // RESERVED_VALIDATION_DATA_INDEX
  "00" + // SignatureType.EOA
  "ff".repeat(32) + // r — any non-zero value
  SECP256K1_N_HALF + // s — secp256k1n/2 (max valid cap)
  "1c") as Hex; // v = 28

/// Returns the on-chain code at an address. For 7702-delegated EOAs the
/// runtime returns a 23-byte "delegation designator" (0xef0100 + impl addr).
/// For undelegated EOAs it returns "0x". We use this to decide whether the
/// next UserOp needs an authorization tuple attached.
export async function readDelegationCode(addr: Address): Promise<Hex> {
  const publicClient = getPublicClient();
  try {
    return await publicClient.getCode({ address: addr }).then((c) => c ?? "0x");
  } catch {
    return "0x";
  }
}

/// True when the EOA has already been delegated to MODULAR_ACCOUNT_V2_IMPL
/// (or any 7702 delegate). Once true, no new authorization tuple is needed.
export async function isEoaDelegated(addr: Address): Promise<boolean> {
  const code = await readDelegationCode(addr);
  return code !== "0x" && code.length > 2;
}

/// ─── Modular Account v2 — Smart Account ──────────────────────────────────
///
/// Builds a viem `SmartAccount` instance backed by Modular Account v2
/// (Alchemy's flagship smart-wallet implementation deployed on RBN testnet).
///
/// Two paths:
///   - `createSmartAccount({ owner })` for new EOAs that sign a UserOp once
///     to deploy their counterfactual smart wallet.
///   - `createEip7702SmartAccount({ owner })` for users keeping the same
///     EOA address — Modular Account v2 implementation is delegated via
///     EIP-7702 authorization tuple instead of a factory deploy.

interface CreateArgs {
  owner: WalletClient;
  ownerAddress: Address;
}

/// Computes the counterfactual smart account address for an owner. Used by
/// UI to show the smart wallet address before it's deployed on-chain (no gas
/// spent unless the user actually sends a UserOp).
async function computeSmartAccountAddress(
  owner: Address,
  salt: bigint = MODULAR_ACCOUNT_V2_SALT,
): Promise<Address> {
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: MODULAR_ACCOUNT_V2_FACTORY,
    abi: MODULAR_ACCOUNT_V2_FACTORY_ABI,
    functionName: "getAddressSemiModular",
    args: [owner, salt],
  });
}

/// Builds the SmartAccount object viem's bundler client expects.
export async function createSmartAccount({
  owner,
  ownerAddress,
}: CreateArgs): Promise<SmartAccount> {
  const address = await computeSmartAccountAddress(ownerAddress);
  const publicClient = getPublicClient();

  return toSmartAccount({
    async getAddress() {
      return address;
    },
    client: publicClient,
    entryPoint: {
      abi: [],
      address: ENTRY_POINT_07,
      version: "0.7",
    },
    extend: {
      ownerAddress,
    },
    async encodeCalls(calls) {
      // Modular Account v2 `execute(target, value, data)` or
      // `executeBatch(calls)` — picks based on call count.
      if (calls.length === 1) {
        return encodeFunctionData({
          abi: [
            {
              type: "function",
              name: "execute",
              inputs: [
                { type: "address" },
                { type: "uint256" },
                { type: "bytes" },
              ],
              outputs: [],
              stateMutability: "payable",
            },
          ],
          functionName: "execute",
          args: [calls[0].to, calls[0].value ?? 0n, calls[0].data ?? "0x"],
        });
      }
      return encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "executeBatch",
            inputs: [
              {
                type: "tuple[]",
                components: [
                  { type: "address", name: "target" },
                  { type: "uint256", name: "value" },
                  { type: "bytes", name: "data" },
                ],
              },
            ],
            outputs: [],
            stateMutability: "payable",
          },
        ],
        functionName: "executeBatch",
        args: [
          calls.map((c) => ({
            target: c.to,
            value: c.value ?? 0n,
            data: c.data ?? ("0x" as Hex),
          })),
        ],
      });
    },
    async signMessage({ message }) {
      return owner.signMessage({ account: ownerAddress, message });
    },
    async signTypedData(typedData) {
      // viem's overloaded signature — rebuild the object so the explicit
      // `account` field is present (WalletClient.signTypedData requires it,
      // but the SmartAccountImplementation typedData param doesn't carry one).
      return owner.signTypedData({
        account: ownerAddress,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      } as Parameters<WalletClient["signTypedData"]>[0]);
    },
    async getStubSignature() {
      return MODULAR_ACCOUNT_V2_STUB_SIGNATURE;
    },
    async signUserOperation(parameters) {
      const { chainId = robinhoodChainTestnetId, ...userOp } = parameters;
      const hash = getUserOperationHash({
        chainId,
        entryPointAddress: ENTRY_POINT_07,
        entryPointVersion: "0.7",
        userOperation: { ...userOp, sender: address } as UserOperation<"0.7">,
      });
      const sig = await owner.signMessage({
        account: ownerAddress,
        message: { raw: hash },
      });
      // Modular Account v2: prepend RESERVED_VALIDATION_DATA_INDEX (0xFF, the
      // sparse-segment final-marker checked by `getFinalSegment`) and the
      // SemiModular fallback `SignatureType.EOA` byte (0x00). Total 67 bytes.
      return ("0xFF00" + sig.slice(2)) as Hex;
    },
    async getNonce() {
      // Ignore any caller-provided key — Modular Account v2 dispatches off it.
      return publicClient.readContract({
        address: ENTRY_POINT_07,
        abi: ENTRY_POINT_GET_NONCE_ABI,
        functionName: "getNonce",
        args: [address, MODULAR_ACCOUNT_V2_NONCE_KEY],
      });
    },
    async getFactoryArgs() {
      // Skip the deploy once code exists at the smart-account address.
      // EntryPoint rejects initCode for already-deployed accounts.
      const code = await publicClient
        .getCode({ address })
        .catch(() => undefined);
      if (code && code !== "0x") {
        return { factory: undefined, factoryData: undefined };
      }
      return {
        factory: MODULAR_ACCOUNT_V2_FACTORY,
        factoryData: encodeFunctionData({
          abi: MODULAR_ACCOUNT_V2_FACTORY_ABI,
          functionName: "createSemiModularAccount",
          args: [ownerAddress, MODULAR_ACCOUNT_V2_SALT],
        }),
      };
    },
  });
}

/// EIP-7702 variant: the smart account address EQUALS the EOA address. The
/// EOA signs an authorization tuple delegating to MODULAR_ACCOUNT_V2_IMPL,
/// and from that block onwards eth_call(eoa) routes through the impl code.
export async function createEip7702SmartAccount({
  owner,
  ownerAddress,
}: CreateArgs): Promise<SmartAccount> {
  const publicClient = getPublicClient();

  return toSmartAccount({
    async getAddress() {
      return ownerAddress; // ← same as EOA, the whole point of 7702
    },
    client: publicClient,
    entryPoint: {
      abi: [],
      address: ENTRY_POINT_07,
      version: "0.7",
    },
    async encodeCalls(calls) {
      // Modular Account v2 `execute(target, value, data)` for single calls,
      // `executeBatch(calls)` for multi-call bundles. Must mirror the factory
      // variant above — using only `execute(calls[0])` silently drops calls
      // 1..N (e.g. the pledge tx after an approve), making the UserOp look
      // successful while the intended action never runs.
      if (calls.length === 1) {
        return encodeFunctionData({
          abi: [
            {
              type: "function",
              name: "execute",
              inputs: [
                { type: "address" },
                { type: "uint256" },
                { type: "bytes" },
              ],
              outputs: [],
              stateMutability: "payable",
            },
          ],
          functionName: "execute",
          args: [calls[0].to, calls[0].value ?? 0n, calls[0].data ?? "0x"],
        });
      }
      return encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "executeBatch",
            inputs: [
              {
                type: "tuple[]",
                components: [
                  { type: "address", name: "target" },
                  { type: "uint256", name: "value" },
                  { type: "bytes", name: "data" },
                ],
              },
            ],
            outputs: [],
            stateMutability: "payable",
          },
        ],
        functionName: "executeBatch",
        args: [
          calls.map((c) => ({
            target: c.to,
            value: c.value ?? 0n,
            data: c.data ?? ("0x" as Hex),
          })),
        ],
      });
    },
    async signMessage({ message }) {
      return owner.signMessage({ account: ownerAddress, message });
    },
    async signTypedData(typedData) {
      return owner.signTypedData({
        account: ownerAddress,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      } as Parameters<WalletClient["signTypedData"]>[0]);
    },
    async getStubSignature() {
      return MODULAR_ACCOUNT_V2_STUB_SIGNATURE;
    },
    async signUserOperation(parameters) {
      const { chainId = robinhoodChainTestnetId, ...userOp } = parameters;
      const hash = getUserOperationHash({
        chainId,
        entryPointAddress: ENTRY_POINT_07,
        entryPointVersion: "0.7",
        userOperation: { ...userOp, sender: ownerAddress } as UserOperation<"0.7">,
      });
      const sig = await owner.signMessage({
        account: ownerAddress,
        message: { raw: hash },
      });
      // Prepend RESERVED_VALIDATION_DATA_INDEX (0xFF) + SignatureType.EOA (0x00).
      return ("0xFF00" + sig.slice(2)) as Hex;
    },
    async getNonce() {
      return publicClient.readContract({
        address: ENTRY_POINT_07,
        abi: ENTRY_POINT_GET_NONCE_ABI,
        functionName: "getNonce",
        args: [ownerAddress, MODULAR_ACCOUNT_V2_NONCE_KEY],
      });
    },
    async getFactoryArgs() {
      // 7702 has no factory deploy — delegation is set via the
      // authorization tuple on the FIRST UserOp, handled separately.
      return { factory: undefined, factoryData: undefined };
    },
  });
}
