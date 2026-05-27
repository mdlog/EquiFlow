import type { Address } from "viem";
import {
  EQUIFLOW_VAULT_ADDRESS,
  USDC_ADDRESS,
  WETH_VAULT_ADDRESS,
  WETH_ADDRESS,
} from "@/lib/contracts/addresses";

export type VaultId = "usdg" | "weth";

export interface VaultConfig {
  id: VaultId;
  label: string;
  /** The borrowable token symbol shown in UI. */
  borrowSymbol: string;
  /** Short description for tooltips. */
  description: string;
  /** Vault contract address. Undefined when not yet deployed. */
  address: Address | undefined;
  /** Underlying (borrowable) token address. */
  tokenAddress: Address | undefined;
  /** Underlying token decimals. */
  tokenDecimals: number;
}

export const VAULT_CONFIGS: VaultConfig[] = [
  {
    id: "usdg",
    label: "USDG Vault",
    borrowSymbol: "USDG",
    description: "Borrow USDG stablecoin against tokenized stocks",
    address: EQUIFLOW_VAULT_ADDRESS,
    tokenAddress: USDC_ADDRESS,
    tokenDecimals: 18,
  },
  {
    id: "weth",
    label: "WETH Vault",
    borrowSymbol: "WETH",
    description: "Borrow WETH against tokenized stocks",
    address: WETH_VAULT_ADDRESS,
    tokenAddress: WETH_ADDRESS,
    tokenDecimals: 18,
  },
];

export const DEFAULT_VAULT: VaultId = "usdg";

export function getVaultConfig(id: VaultId): VaultConfig {
  return VAULT_CONFIGS.find((v) => v.id === id) ?? VAULT_CONFIGS[0];
}

export function getActiveVaults(): VaultConfig[] {
  return VAULT_CONFIGS.filter((v) => !!v.address);
}
