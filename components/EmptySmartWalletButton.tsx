"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  ERC20_ABI,
  STOCK_TOKEN_ADDRESSES,
  explorerTx,
} from "@/lib/contracts";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import { sendUserOp } from "@/lib/aa/send-userop";
import { AssetLogo } from "@/components/AssetLogo";

/// Drains every ERC20 balance the smart wallet holds back to the connected
/// EOA owner in a single sponsored UserOp. Useful when the user switches AA
/// modes mid-flow and wants their tokens back on the original address.
///
/// Only renders when AA mode is active (factory or eip7702) — in EOA mode the
/// EOA already holds everything, no recovery needed.

interface Tracked {
  symbol: string;
  address: Address;
  decimals: number;
}

const STOCK_TOKENS: Tracked[] = Object.entries(STOCK_TOKEN_ADDRESSES)
  .filter((entry): entry is [string, Address] => !!entry[1])
  .map(([sym, addr]) => ({ symbol: sym, address: addr, decimals: 18 }));

export function EmptySmartWalletButton() {
  const { vault } = useVaultContext();
  const TOKEN_ADDR = vault.tokenAddress;
  const tokenSymbol = vault.borrowSymbol;

  const { address: eoaAddress } = useAccount();
  const { mode, smartAccount, smartAddress } = useSmartWallet();

  const TOKENS: Tracked[] = useMemo(
    () => [
      ...(TOKEN_ADDR
        ? [{ symbol: tokenSymbol, address: TOKEN_ADDR, decimals: vault.tokenDecimals } as Tracked]
        : []),
      ...STOCK_TOKENS,
    ],
    [TOKEN_ADDR, tokenSymbol, vault.tokenDecimals],
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { ok: true; txHash: Hex } | { ok: false; error: string } | null
  >(null);

  const { data: rawBalances, refetch } = useReadContracts({
    allowFailure: true,
    contracts: smartAddress
      ? TOKENS.map((t) => ({
          abi: ERC20_ABI,
          address: t.address,
          functionName: "balanceOf" as const,
          args: [smartAddress] as const,
          chainId: ROBINHOOD_CHAIN_TESTNET_ID,
        }))
      : [],
    query: {
      enabled: !!smartAddress && mode !== "off",
      refetchInterval: 15_000,
    },
  });

  // Decimals read on-chain. The vault's USDG token is 6-decimals (USDC-style)
  // even though VaultConfig.tokenDecimals is 18 (internal USD accounting), so a
  // hardcoded 18 made USDG render as 0.0000 here. Static → cache forever.
  const { data: rawDecimals } = useReadContracts({
    allowFailure: true,
    contracts: TOKENS.map((t) => ({
      abi: ERC20_ABI,
      address: t.address,
      functionName: "decimals" as const,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    })),
    query: { enabled: mode !== "off", staleTime: Infinity },
  });

  const nonZero = useMemo(() => {
    if (!rawBalances) return [];
    return TOKENS.map((t, i) => {
      const r = rawBalances[i];
      const bal =
        r && r.status === "success" ? (r.result as bigint) : 0n;
      const d = rawDecimals?.[i];
      const decimals =
        d && d.status === "success" ? Number(d.result) : t.decimals;
      return { ...t, decimals, balance: bal };
    }).filter((t) => t.balance > 0n);
  }, [rawBalances, rawDecimals]);

  if (mode === "off" || !smartAddress || !eoaAddress) return null;

  async function handleEmpty() {
    if (!smartAccount || !eoaAddress || nonZero.length === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const calls = nonZero.map((t) => ({
        to: t.address,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [eoaAddress, t.balance],
        }),
      }));
      const { txHash } = await sendUserOp({
        smartAccount,
        calls,
        gasMode: "sponsored",
      });
      setResult({ ok: true, txHash });
      // Trigger re-read so balances flip to 0 immediately in the UI.
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ ok: false, error: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-3 py-2.5 border-b border-hairline-soft">
      <div
        className="eyebrow flex items-center justify-between mb-1.5"
        style={{ fontSize: 9 }}
      >
        <span>Recover to EOA</span>
        {nonZero.length > 0 && (
          <span style={{ fontSize: 9, opacity: 0.5 }}>
            {nonZero.length} token{nonZero.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {nonZero.length === 0 ? (
        <div
          className="opacity-50 font-mono"
          style={{ fontSize: 10 }}
        >
          Smart wallet is empty
        </div>
      ) : (
        <>
          <div className="mb-2 space-y-1">
            {nonZero.map((t) => (
              <div
                key={t.address}
                className="flex items-center justify-between"
                style={{ fontSize: 10 }}
              >
                <div className="flex items-center gap-1.5">
                  <TokenIcon symbol={t.symbol} />
                  <span className="font-mono">{t.symbol}</span>
                </div>
                <span className="font-mono tabular">
                  {(Number(t.balance) / 10 ** t.decimals).toFixed(4)}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleEmpty}
            disabled={busy}
            className="w-full px-2.5 py-1.5 rounded-[2px] border border-ink transition-colors hover:bg-ink hover:text-paper"
            style={{
              fontSize: 11,
              opacity: busy ? 0.5 : 1,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Sending…" : "Send all → EOA"}
          </button>
        </>
      )}

      {result?.ok && (
        <a
          href={explorerTx(result.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 block font-mono no-underline text-up"
          style={{ fontSize: 10 }}
        >
          ✓ Sent · view tx ↗
        </a>
      )}
      {result && !result.ok && (
        <div
          className="mt-1.5 font-mono leading-tight text-down"
          style={{ fontSize: 10 }}
        >
          ⨯ {result.error.slice(0, 100)}
        </div>
      )}
    </div>
  );
}

/// Renders the right glyph for each token in the wallet list. USDG ships its
/// own logo file in /public; everything else (stocks like AMZN, TSLA, …)
/// reuses the favicon-backed AssetLogo. We keep this trivial so the dropdown
/// stays lightweight even with many tokens.
function TokenIcon({ symbol }: { symbol: string }) {
  if (symbol === "USDG") {
    return (
      <img
        src="/logo-usdg.png"
        alt="USDG"
        width={16}
        height={16}
        style={{
          width: 16,
          height: 16,
          objectFit: "contain",
          display: "block",
        }}
      />
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ width: 16, height: 16 }}
    >
      <AssetLogo sym={symbol} size={16} />
    </span>
  );
}
