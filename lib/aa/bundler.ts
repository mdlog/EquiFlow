"use client";

import { createPublicClient, http, type PublicClient } from "viem";
import { createBundlerClient } from "viem/account-abstraction";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { robinhoodChainTestnet } from "@/lib/config/chain";
import {
  ENTRY_POINT_07,
  alchemyBundlerUrl,
  alchemyPaymasterUrl,
  GAS_POLICY_ID,
} from "@/lib/web3/alchemy";

/// ─── Bundler & Paymaster Clients ─────────────────────────────────────────
///
/// One bundler client per browser session. Viem's bundler client speaks
/// `eth_sendUserOperation` etc. against Alchemy's Rundler endpoint on RBN.
///
/// We use `permissionless`'s `createPimlicoClient` for paymaster operations
/// because it exposes a cleaner sponsorship API than raw RPC, but Alchemy's
/// Gas Manager is fully compatible — Pimlico/Alchemy/Stackup all speak the
/// same ERC-7677 paymaster RPC.

let _bundlerClient: ReturnType<typeof createBundlerClient> | null = null;
let _publicClient: PublicClient | null = null;

/// Paymaster clients are cached per policyId. Two distinct policies
/// (sponsored vs. ERC20-USDG paymaster) point at different Alchemy URLs
/// and must NOT share a client — a single-slot cache would silently
/// return the wrong policy after a user toggles gas mode.
const _paymasterClients = new Map<
  string,
  ReturnType<typeof createPimlicoClient>
>();

export function getPublicClient(): PublicClient {
  if (_publicClient) return _publicClient;
  _publicClient = createPublicClient({
    chain: robinhoodChainTestnet,
    transport: http(robinhoodChainTestnet.rpcUrls.default.http[0]),
  });
  return _publicClient;
}

export function getBundlerClient() {
  if (_bundlerClient) return _bundlerClient;
  _bundlerClient = createBundlerClient({
    chain: robinhoodChainTestnet,
    transport: http(alchemyBundlerUrl()),
  });
  return _bundlerClient;
}

/// Returns a paymaster client only when a policy ID is configured. Callers
/// should check this before adding `paymaster` to a UserOp — without it,
/// the bundler will reject the op as missing sponsorship.
export function getPaymasterClient(policyId: string = GAS_POLICY_ID) {
  const url = alchemyPaymasterUrl(policyId);
  if (!policyId || !url) return null;
  const cached = _paymasterClients.get(policyId);
  if (cached) return cached;
  const client = createPimlicoClient({
    chain: robinhoodChainTestnet,
    transport: http(url),
    entryPoint: { address: ENTRY_POINT_07, version: "0.7" },
  });
  _paymasterClients.set(policyId, client);
  return client;
}

/// Reset cached clients — used when the user changes networks or API key.
export function resetAAClients() {
  _bundlerClient = null;
  _publicClient = null;
  _paymasterClients.clear();
}
