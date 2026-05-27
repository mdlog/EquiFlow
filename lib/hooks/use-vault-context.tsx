"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Address } from "viem";
import {
  type VaultId,
  type VaultConfig,
  DEFAULT_VAULT,
  getVaultConfig,
  getActiveVaults,
} from "@/lib/config/vaults";

interface VaultContextValue {
  vaultId: VaultId;
  vault: VaultConfig;
  setVaultId: (id: VaultId) => void;
  activeVaults: VaultConfig[];
  isMultiVault: boolean;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [vaultId, setVaultIdRaw] = useState<VaultId>(DEFAULT_VAULT);
  const activeVaults = getActiveVaults();

  const setVaultId = useCallback((id: VaultId) => {
    const cfg = getVaultConfig(id);
    if (cfg.address) setVaultIdRaw(id);
  }, []);

  const vault = getVaultConfig(vaultId);

  return (
    <VaultContext.Provider
      value={{
        vaultId,
        vault,
        setVaultId,
        activeVaults,
        isMultiVault: activeVaults.length > 1,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVaultContext(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) {
    return {
      vaultId: DEFAULT_VAULT,
      vault: getVaultConfig(DEFAULT_VAULT),
      setVaultId: () => {},
      activeVaults: getActiveVaults(),
      isMultiVault: getActiveVaults().length > 1,
    };
  }
  return ctx;
}
