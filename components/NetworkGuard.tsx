"use client";

import { useEffect, useRef } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { isWrongNetwork } from "@/lib/web3/network";

/// Headless guard (mounted once in Providers, like PriceKeeperMount). When the
/// connected wallet is on a network other than Robinhood Chain Testnet, it
/// auto-fires `wallet_switchEthereumChain` so MetaMask/Rabby shows a switch-
/// confirm popup — adding the chain first if the wallet doesn't have it (wagmi
/// supplies the chain params from `robinhoodChainTestnet`). The header's
/// "Switch to Robinhood Chain" button (WalletButton) stays as a manual fallback
/// if the user dismisses the popup.
export function NetworkGuard() {
  const { isConnected, chainId: walletChainId } = useAccount();
  const { switchChain } = useSwitchChain();

  // Which wrong chain we've already prompted for. Prompting once per distinct
  // wrong chain keeps a rejection from looping the popup (and from re-creating
  // the "Requested resource not available" / -32002 a second pending request
  // would cause), while still re-prompting if the user later lands on yet
  // another wrong network.
  const promptedForChain = useRef<number | null>(null);

  useEffect(() => {
    if (!isWrongNetwork(isConnected, walletChainId, ROBINHOOD_CHAIN_TESTNET_ID)) {
      // Correct chain / disconnected / still resolving → re-arm for next time.
      promptedForChain.current = null;
      return;
    }
    if (promptedForChain.current === walletChainId) return;

    // Small delay so we don't collide with a connect-time request still settling
    // in the wallet (which would itself bounce with -32002). The ref is set
    // inside the timer so a cleanup before it fires re-arms cleanly.
    const t = setTimeout(() => {
      promptedForChain.current = walletChainId ?? null;
      switchChain(
        { chainId: ROBINHOOD_CHAIN_TESTNET_ID },
        // Swallow rejection/pending errors: the once-guard already prevents a
        // retry loop, and the manual header button remains available.
        { onError: () => {} },
      );
    }, 350);
    return () => clearTimeout(t);
  }, [isConnected, walletChainId, switchChain]);

  return null;
}
