"use client";

import { useAccount } from "wagmi";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import { type Address } from "viem";

/// ─── useActiveWallet — unified caller identity ───────────────────────────
///
/// Returns the address that on-chain reads/writes should be attributed to.
/// In EOA mode that's `wagmi.useAccount().address`. In smart-wallet mode
/// it's the smart account address — except for EIP-7702, where the smart
/// account address IS the EOA address (so reads work uniformly).
///
/// Components use this instead of `useAccount()` directly so the same code
/// works for all three wallet modes.

export interface ActiveWallet {
  /** Active address used for balance/allowance/position lookups. */
  address: Address | undefined;
  /** True when an AA mode (factory or 7702) is selected and ready. */
  isSmartWallet: boolean;
  /** "off" | "factory" | "eip7702" */
  aaMode: "off" | "factory" | "eip7702";
  /** True while the smart account is being built. */
  isLoading: boolean;
  /** Underlying EOA address — always populated when connected. */
  eoaAddress: Address | undefined;
  /** Whether a wallet (any mode) is currently connected. */
  isConnected: boolean;
}

export function useActiveWallet(): ActiveWallet {
  const { address: eoaAddress, isConnected } = useAccount();
  const { mode, smartAddress, isLoading } = useSmartWallet();

  const isSmartWallet = mode !== "off" && smartAddress != null;
  const activeAddress = isSmartWallet ? smartAddress : eoaAddress;

  return {
    address: activeAddress ?? undefined,
    isSmartWallet,
    aaMode: mode,
    isLoading,
    eoaAddress: eoaAddress ?? undefined,
    isConnected: isConnected || isSmartWallet,
  };
}
