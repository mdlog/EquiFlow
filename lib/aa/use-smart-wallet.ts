"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { type SmartAccount } from "viem/account-abstraction";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import {
  createSmartAccount,
  createEip7702SmartAccount,
} from "./smart-account";
import { ensureDelegation } from "./eip7702";
import { AA_CONFIGURED } from "@/lib/web3/alchemy";

/// Confirmation copy shown when the wallet can't sign a 7702 authorization
/// standalone (the norm for Rabby/MetaMask in 2026) and we need to fall back
/// to a one-time on-chain delegation tx. Kept verbose so the user understands
/// exactly what they're approving and that it only happens once.
const ONCHAIN_DELEGATION_CONFIRM = [
  "⚠️  Enable EIP-7702 (one-time cost)",
  "",
  "Your wallet needs an on-chain transaction to enable",
  "EIP-7702 delegation.",
  "",
  "• Cost: small ETH gas fee (one-time)",
  "• After: all pledges/borrows are GASLESS (sponsored)",
  "• Same address — your existing token balance stays usable",
  "",
  "Click OK to approve the delegation transaction in your wallet.",
  "Click Cancel to keep your EOA as-is.",
].join("\n");

/// ─── useSmartWallet — main client hook (Context-backed) ─────────────────
///
/// Wraps a single SmartAccount instance shared across the whole React tree
/// via SmartWalletProvider. Earlier versions held state in `useState` inside
/// the hook itself, which meant every caller (WalletButton, StockBalanceCell,
/// each modal, …) instantiated ITS OWN copy of mode + smartAccount. Mode
/// flips made via one component never propagated to the others — the UI
/// looked frozen until a page reload re-hydrated from localStorage.
///
/// Three modes:
///   - "off"       : user hasn't opted in; only EOA in use
///   - "factory"   : new counterfactual smart wallet (different address than EOA)
///   - "eip7702"   : EOA address upgraded via 7702 (same address)
///
/// Mode is persisted in localStorage so the choice survives page reloads.

const STORAGE_KEY = "equiflow.aa.mode.v1";

export type AAMode = "off" | "factory" | "eip7702";

function readMode(): AAMode {
  if (typeof window === "undefined") return "off";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  // Auto-migrate: per Alchemy docs, browser-injected wallets (MetaMask, Rabby,
  // Coinbase) don't support sponsored EIP-7702 delegation to third-party
  // contracts. We removed the 7702 option from the picker — any persisted
  // "eip7702" mode from prior sessions silently falls back to factory so the
  // user lands in a working state on next load.
  if (stored === "eip7702") {
    window.localStorage.setItem(STORAGE_KEY, "factory");
    return "factory";
  }
  if (stored === "factory") return stored;
  return "off";
}

function writeMode(mode: AAMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export interface SmartWalletState {
  mode: AAMode;
  smartAccount: SmartAccount | null;
  smartAddress: `0x${string}` | null;
  isLoading: boolean;
  isConfigured: boolean;
  setMode: (next: AAMode) => void;
  /// For "eip7702" mode: triggers the authorization-tuple signature if the
  /// EOA isn't already delegated. Safe to call multiple times — no-op once
  /// delegated. Throws if user rejects the signature.
  prepareForSubmit: () => Promise<void>;
}

const SmartWalletContext = createContext<SmartWalletState | null>(null);

export function SmartWalletProvider({ children }: { children: ReactNode }) {
  const { address: eoaAddress } = useAccount();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const queryClient = useQueryClient();
  const onCorrectChain = chainId === ROBINHOOD_CHAIN_TESTNET_ID;

  const [mode, setModeState] = useState<AAMode>("off");
  const [smartAccount, setSmartAccount] = useState<SmartAccount | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Hydrate persisted mode after mount (avoid SSR mismatch).
  useEffect(() => {
    setModeState(readMode());
  }, []);

  const setMode = useCallback(
    (next: AAMode) => {
      setModeState(next);
      writeMode(next);
      // Flush every wagmi-cached read (balances, allowances, positions, etc.)
      // so the dropdown + page content reflect the new active address
      // immediately instead of showing the prior mode's stale data while
      // wagmi's refetchInterval (15-30s) catches up. Mode flips are rare and
      // user-initiated, so the extra refetch cost is acceptable.
      queryClient.invalidateQueries();
    },
    [queryClient],
  );

  // Rebuild SmartAccount whenever the owner EOA / mode / chain changes.
  useEffect(() => {
    let cancelled = false;
    async function build() {
      if (mode === "off" || !walletClient || !eoaAddress || !onCorrectChain) {
        setSmartAccount(null);
        return;
      }
      setIsLoading(true);
      try {
        const account =
          mode === "eip7702"
            ? await createEip7702SmartAccount({
                owner: walletClient,
                ownerAddress: eoaAddress,
              })
            : await createSmartAccount({
                owner: walletClient,
                ownerAddress: eoaAddress,
              });
        if (!cancelled) setSmartAccount(account);
      } catch (err) {
        console.error("[useSmartWallet] build failed:", err);
        if (!cancelled) setSmartAccount(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    build();
    return () => {
      cancelled = true;
    };
  }, [mode, walletClient, eoaAddress, onCorrectChain]);

  const prepareForSubmit = useCallback(async () => {
    if (mode !== "eip7702" || !walletClient || !eoaAddress) return;
    // If the wallet rejects standalone signing (the common case for
    // Rabby/MetaMask in 2026), ensureDelegation falls through to this
    // callback. We surface a native confirm dialog explaining the one-time
    // gas cost so the user is never surprised by an ETH charge in a flow
    // advertised as "sponsored".
    await ensureDelegation(walletClient, eoaAddress, async () => {
      if (typeof window === "undefined") return false;
      return window.confirm(ONCHAIN_DELEGATION_CONFIRM);
    });
  }, [mode, walletClient, eoaAddress]);

  const value = useMemo<SmartWalletState>(
    () => ({
      mode,
      smartAccount,
      smartAddress: smartAccount?.address ?? null,
      isLoading,
      isConfigured: AA_CONFIGURED,
      setMode,
      prepareForSubmit,
    }),
    [mode, smartAccount, isLoading, setMode, prepareForSubmit],
  );

  // No JSX in this .ts file — use createElement so we don't need to rename
  // the module to .tsx and churn every existing import path.
  return createElement(SmartWalletContext.Provider, { value }, children);
}

export function useSmartWallet(): SmartWalletState {
  const ctx = useContext(SmartWalletContext);
  if (!ctx) {
    throw new Error(
      "useSmartWallet must be called inside <SmartWalletProvider>. " +
        "Add it to app/providers.tsx above the consuming subtree.",
    );
  }
  return ctx;
}
