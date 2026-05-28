// Ambient declaration of `window.ethereum`. Drops the `window as unknown as
// { ethereum?: ... }` cast scattered across the AA layer.

import type { EIP1193Provider } from "viem";

declare global {
  interface Window {
    ethereum?: EIP1193Provider & {
      isMetaMask?: boolean;
      providers?: readonly EIP1193Provider[];
    };
  }
}

export {};
