import { http } from "wagmi";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { robinhoodChainTestnet } from "@/lib/config/chain";

let cached: ReturnType<typeof getDefaultConfig> | null = null;

export function getWagmiConfig() {
  if (cached) return cached;
  cached = getDefaultConfig({
    appName: "EquiFlow",
    projectId:
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "equiflow-dev",
    chains: [robinhoodChainTestnet],
    transports: {
      [robinhoodChainTestnet.id]: http(
        robinhoodChainTestnet.rpcUrls.default.http[0],
      ),
    },
    ssr: true,
  });
  return cached;
}
