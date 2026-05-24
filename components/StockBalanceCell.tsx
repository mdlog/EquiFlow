"use client";

import { useActiveWallet } from "@/lib/hooks/use-active-wallet";
import { useStockBalance } from "@/lib/hooks/use-stock-balance";
import { fmt } from "@/lib/format";

/// Public wrapper: keys the inner cell on the active address so React fully
/// unmounts + remounts when the user flips between EOA and smart-wallet
/// modes. Without this, wagmi briefly returns the prior mode's cached balance
/// during refetch — the user sees their smart-wallet shares lingering in EOA
/// mode (where the EOA actually holds 0). The remount forces a clean loading
/// state, then the new address's balance.
export function StockBalanceCell({ sym, price }: { sym: string; price: number }) {
  const { address, isConnected } = useActiveWallet();
  return (
    <StockBalanceCellInner
      key={address ?? "no-wallet"}
      sym={sym}
      price={price}
      isConnected={isConnected}
    />
  );
}

function StockBalanceCellInner({
  sym,
  price,
  isConnected,
}: {
  sym: string;
  price: number;
  isConnected: boolean;
}) {
  const bal = useStockBalance(sym);

  if (!bal.configured) {
    return (
      <div className="text-ink-mute font-mono" style={{ fontSize: 10 }}>
        token unconfigured
      </div>
    );
  }
  if (!isConnected) {
    return (
      <div className="text-ink-mute font-mono" style={{ fontSize: 10 }}>
        connect wallet
      </div>
    );
  }
  if (!bal.ready) {
    return (
      <div className="text-ink-mute font-mono" style={{ fontSize: 10 }}>
        loading…
      </div>
    );
  }

  const shares = bal.formatted ?? 0;
  const usd = shares * price;
  return (
    <div>
      <div className="font-mono tabular font-medium" style={{ fontSize: 12 }}>
        {fmt.num(shares, shares < 1 ? 4 : 2)} {sym}
      </div>
      <div className="text-ink-mute font-mono tabular mt-0.5" style={{ fontSize: 10 }}>
        ≈ {fmt.usd(usd, usd >= 1000 ? 0 : 2)}
      </div>
    </div>
  );
}
