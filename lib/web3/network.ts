// Network/chain guard helpers. The wagmi config lists only Robinhood Chain
// Testnet, so any wallet connected to another network is "wrong network" and we
// want to prompt a switch (wallet_switchEthereumChain, adding the chain if the
// wallet doesn't have it yet).

/// True when a connected wallet is on a network other than the target chain
/// (so we should prompt a switch). Returns false when not connected or when the
/// wallet's chain is still resolving (`undefined`) — so we never prompt
/// prematurely before the connector reports its chain.
export function isWrongNetwork(
  isConnected: boolean,
  walletChainId: number | undefined,
  targetChainId: number,
): boolean {
  if (!isConnected) return false;
  if (walletChainId == null) return false;
  return walletChainId !== targetChainId;
}
