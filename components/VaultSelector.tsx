"use client";

import { useVaultContext } from "@/lib/hooks/use-vault-context";
import type { VaultId } from "@/lib/config/vaults";

export function VaultSelector({ compact }: { compact?: boolean }) {
  const { vaultId, setVaultId, activeVaults, isMultiVault } = useVaultContext();

  if (!isMultiVault) return null;

  return (
    <div className="flex gap-1 p-[3px] border border-hairline rounded-[2px]">
      {activeVaults.map((v) => (
        <button
          key={v.id}
          onClick={() => setVaultId(v.id)}
          className="border-0 rounded-[2px] transition-colors"
          title={v.description}
          style={{
            padding: compact ? "5px 10px" : "7px 12px",
            fontSize: compact ? 11 : 12,
            background:
              vaultId === v.id ? "var(--ink)" : "transparent",
            color:
              vaultId === v.id ? "var(--paper)" : "var(--ink-soft)",
            fontWeight: vaultId === v.id ? 500 : 400,
            fontFamily: "var(--font-jetbrains-mono)",
            letterSpacing: "0.02em",
          }}
        >
          {v.borrowSymbol}
        </button>
      ))}
    </div>
  );
}
