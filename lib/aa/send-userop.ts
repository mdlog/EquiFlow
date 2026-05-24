"use client";

import { type Address, type Hex } from "viem";
import { type SmartAccount } from "viem/account-abstraction";
import {
  getBundlerClient,
  getPaymasterClient,
} from "./bundler";
import { AA_CONFIGURED, GAS_POLICY_ID, GAS_POLICY_ID_USDG } from "@/lib/web3/alchemy";
import { clearPendingAuth, readPendingAuth } from "./eip7702";

/// ─── UserOperation Send & Wait ───────────────────────────────────────────
///
/// One small helper that wraps the full submission flow:
///   1. Optionally fetch sponsor data from the Gas Manager paymaster
///   2. Build the UserOp via the bundler client + smart account
///   3. Submit to the bundler
///   4. Wait for inclusion + return the receipt
///
/// Two policy variants supported:
///   - GAS_POLICY_ID       → native gas, fully sponsored (Tier 2 default)
///   - GAS_POLICY_ID_USDG  → ERC20 paymaster, user pays gas in USDG (Tier 5)

export interface Call {
  to: Address;
  data?: Hex;
  value?: bigint;
}

export type GasMode = "sponsored" | "usdg" | "self";

export interface SendUserOpArgs {
  smartAccount: SmartAccount;
  calls: Call[];
  /** "sponsored" = paymaster pays, "usdg" = ERC20 paymaster in USDG, "self" = user pays in native */
  gasMode?: GasMode;
}

export class AANotConfiguredError extends Error {
  constructor() {
    super(
      "Alchemy API key missing — set NEXT_PUBLIC_ALCHEMY_API_KEY in .env.local. " +
        "Smart wallet UI is visible but UserOp submission requires a valid key.",
    );
    this.name = "AANotConfiguredError";
  }
}

/// Submits a batched UserOperation and waits for the receipt.
///
/// Returns the L2 transaction hash (the on-chain handleOps tx submitted by
/// the bundler). On failure, throws with the bundler's revert reason intact
/// so the UI can surface "insufficient allowance", "policy denied", etc.
export async function sendUserOp({
  smartAccount,
  calls,
  gasMode = "sponsored",
}: SendUserOpArgs): Promise<{ txHash: Hex; userOpHash: Hex }> {
  if (!AA_CONFIGURED) {
    throw new AANotConfiguredError();
  }

  const bundlerClient = getBundlerClient();

  // Resolve the paymaster policy for this gas mode.
  const policyId =
    gasMode === "usdg" ? GAS_POLICY_ID_USDG :
    gasMode === "sponsored" ? GAS_POLICY_ID :
    "";

  const paymasterClient = policyId ? getPaymasterClient(policyId) : null;

  // If a 7702 authorization tuple is pending in localStorage, attach it to
  // this UserOp. The bundler forwards it to the EntryPoint v0.7 which
  // applies the delegation during this op's execution — from the NEXT block
  // onwards, the EOA dispatches through Modular Account v2 automatically.
  const pendingAuth = readPendingAuth(smartAccount.address as Address);

  // viem's sendUserOperation orchestrates fee fetch, sponsor data, sign,
  // and submit in one call. paymaster=true means "use the connected
  // paymaster client to populate paymaster fields"; we pass our pimlico
  // client to the bundler via the `paymaster` arg.
  //
  // RBN bundler precheck: maxPriorityFeePerGas must be at least ~476250 wei
  // (0.0004 gwei). viem defaults it to 0, which the bundler rejects with
  // "precheck failed". 0.05 gwei is a safe floor that won't push UserOp cost
  // meaningfully higher.
  const MIN_PRIORITY_FEE = 50_000_000n; // 0.05 gwei
  const userOpHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: calls.map((c) => ({
      to: c.to,
      data: c.data ?? ("0x" as Hex),
      value: c.value ?? 0n,
    })),
    maxPriorityFeePerGas: MIN_PRIORITY_FEE,
    ...(paymasterClient
      ? {
          paymaster: paymasterClient,
          paymasterContext: { policyId },
        }
      : {}),
    ...(pendingAuth
      ? {
          // viem accepts `authorization` for 7702 — passed through to the
          // bundler's eip7702Auth UserOp field.
          authorization: pendingAuth.tuple,
        }
      : {}),
  } as Parameters<typeof bundlerClient.sendUserOperation>[0]);

  // Wait for inclusion. Bundler returns the L2 tx hash containing this op.
  const receipt = await bundlerClient.waitForUserOperationReceipt({
    hash: userOpHash,
    timeout: 60_000,
  });

  if (!receipt.success) {
    throw new Error(
      `UserOp reverted: ${receipt.reason ?? "unknown"} (op hash: ${userOpHash})`,
    );
  }

  // Authorization was applied as part of this op — clear the pending tuple
  // so subsequent ops don't try to re-apply it (and waste a slot in the
  // calldata).
  if (pendingAuth) clearPendingAuth();

  return {
    txHash: receipt.receipt.transactionHash,
    userOpHash,
  };
}
