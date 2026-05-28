"use client";

import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { Toaster } from "sonner";
import { getWagmiConfig } from "@/lib/web3/wagmi";
import { robinhoodChainTestnet } from "@/lib/config/chain";
import { PriceKeeperMount } from "@/components/PriceKeeperMount";
import { SmartWalletProvider } from "@/lib/aa/use-smart-wallet";
import { VaultProvider } from "@/lib/hooks/use-vault-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 8_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={getWagmiConfig()}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={robinhoodChainTestnet}
          theme={lightTheme({
            accentColor: "#141210",
            accentColorForeground: "#FAF7F0",
            borderRadius: "small",
            fontStack: "system",
            overlayBlur: "small",
          })}
          appInfo={{ appName: "EquiFlow" }}
          showRecentTransactions
        >
          <SmartWalletProvider>
            <VaultProvider>
              <PriceKeeperMount />
              {children}
              <Toaster
                position="bottom-right"
                richColors
                closeButton
                toastOptions={{
                  style: {
                    fontFamily: "var(--font-geist)",
                    fontSize: "var(--text-body)",
                    borderRadius: "var(--radius-xs)",
                  },
                }}
              />
            </VaultProvider>
          </SmartWalletProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
