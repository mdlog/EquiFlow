"use client";

import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, maxUint256, parseUnits, type Address, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  ERC20_ABI,
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
} from "@/lib/contracts";
import { findStock, stockAddress, isLive } from "@/lib/config/stocks";
import { useStockPrice } from "@/lib/hooks/use-adapter-price";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { fmt } from "@/lib/format";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import { sendUserOp } from "@/lib/aa/send-userop";
import { AA_CONFIGURED } from "@/lib/web3/alchemy";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import { useListedAssets, useProtocolStats } from "@/lib/hooks/use-protocol-stats";
import { VaultSelector } from "@/components/VaultSelector";
import { AssetLogo } from "@/components/AssetLogo";
import { useEthPrice } from "@/lib/hooks/use-eth-price";

type Stage = "idle" | "approve" | "approving" | "lock" | "locking" | "bundling" | "sealed";

interface Props {
  sym: string;
  open: boolean;
  onClose: () => void;
}

export function PledgeSidebar({ sym, open, onClose }: Props) {
  const { vault } = useVaultContext();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const s = findStock(sym);
  const tokenAddr = stockAddress(sym);
  const live = isLive(sym);
  const onCorrectChain = chainId === ROBINHOOD_CHAIN_TESTNET_ID;

  const { price: livePrice, liqThreshold } = useStockPrice(sym);
  const spender =
    vault.address ?? EQUIFLOW_VAULT_ADDRESS ??
    ("0x000000000000000000000000000000000000dEaD" as Address);

  const [sharesStr, setSharesStr] = useState("");
  const shares = Math.max(0, Number(sharesStr) || 0);
  const [borrowPct, setBorrowPct] = useState(60);
  const [stage, setStage] = useState<Stage>("idle");

  const { data: decimals } = useReadContract({
    abi: ERC20_ABI,
    address: tokenAddr,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!tokenAddr },
  });
  const dec = (decimals as number | undefined) ?? 18;

  const {
    mode: aaMode,
    smartAccount,
    smartAddress,
    prepareForSubmit,
  } = useSmartWallet();
  const aaActive = aaMode !== "off" && smartAccount != null;
  const callerAddress = (aaActive && smartAddress ? smartAddress : address) as
    | Address
    | undefined;

  const { data: balance, refetch: refetchBalance } = useReadContract({
    abi: ERC20_ABI,
    address: tokenAddr,
    functionName: "balanceOf",
    args: callerAddress ? [callerAddress] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!tokenAddr && !!callerAddress, refetchInterval: 12_000 },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: ERC20_ABI,
    address: tokenAddr,
    functionName: "allowance",
    args: callerAddress ? [callerAddress, spender] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!tokenAddr && !!callerAddress, refetchInterval: 12_000 },
  });

  const listedAddrs = useListedAssets(vault.address);
  const vaultStats = useProtocolStats(listedAddrs, vault.address, vault.tokenAddress);
  const vaultLiquidityRaw =
    vaultStats.liquidityUsd != null
      ? Number(vaultStats.liquidityUsd) / 1e18
      : null;

  const { price: ethPrice } = useEthPrice();
  const isWethVault = vault.id === "weth";

  const vaultLiquidityDisplay =
    vaultLiquidityRaw != null
      ? isWethVault
        ? `${vaultLiquidityRaw < 0.001 && vaultLiquidityRaw > 0 ? vaultLiquidityRaw.toFixed(6) : vaultLiquidityRaw.toFixed(4)} WETH`
        : fmt.usd(vaultLiquidityRaw, 2)
      : null;

  const MIN_BORROW_USD = 10;
  const collateralUsd = livePrice * shares;
  const maxBorrow = collateralUsd * s.ltv;
  const borrowUsd = maxBorrow * (borrowPct / 100);
  const ltvActual = collateralUsd > 0 ? (borrowUsd / collateralUsd) * 100 : 0;
  const liqAt = liqThreshold * 100;
  const healthFactor = ltvActual > 0 ? liqAt / ltvActual : 99;
  const borrowBelowMinimum = borrowUsd > 0 && borrowUsd < MIN_BORROW_USD;

  const borrowTokenAmount =
    isWethVault && ethPrice && ethPrice > 0 ? borrowUsd / ethPrice : null;

  const borrowExceedsLiquidity = (() => {
    if (borrowUsd <= 0 || vaultLiquidityRaw == null) return false;
    if (isWethVault) {
      const borrowWeth = ethPrice && ethPrice > 0 ? borrowUsd / ethPrice : 0;
      return borrowWeth > vaultLiquidityRaw;
    }
    return borrowUsd > vaultLiquidityRaw;
  })();

  const shareAmountRaw = useMemo(() => {
    try { return parseUnits(shares.toString(), dec); }
    catch { return 0n; }
  }, [shares, dec]);

  const needsApproval =
    live && allowance !== undefined && shareAmountRaw > (allowance as bigint);
  const insufficient =
    live && balance !== undefined && shareAmountRaw > (balance as bigint);
  const balanceDisplay =
    balance !== undefined && dec
      ? Number(balance as bigint) / 10 ** dec
      : null;

  const {
    writeContract,
    data: txHash,
    isPending: writePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const { isLoading: receiptPending, isSuccess: receiptSuccess } =
    useWaitForTransactionReceipt({
      hash: txHash,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });

  useEffect(() => {
    if (!receiptSuccess) return;
    if (stage === "approving") {
      resetWrite();
      refetchAllowance().then(() => setStage("lock"));
    } else if (stage === "locking") {
      setStage("sealed");
      refetchBalance();
    }
  }, [receiptSuccess, stage, resetWrite, refetchAllowance, refetchBalance]);

  const [aaTxHash, setAaTxHash] = useState<Hex | null>(null);
  const [aaError, setAaError] = useState<string | null>(null);

  const handleBundle = async () => {
    if (!tokenAddr || !spender || !smartAccount) return;
    setAaError(null);
    setStage("bundling");
    try {
      await prepareForSubmit();
      const borrowUsdScaled =
        borrowUsd > 0 ? parseUnits(borrowUsd.toFixed(18), 18) : 0n;
      const calls = [];
      if (allowance === undefined || shareAmountRaw > (allowance as bigint)) {
        calls.push({
          to: tokenAddr,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [spender, maxUint256],
          }),
        });
      }
      calls.push({
        to: spender as Address,
        data: encodeFunctionData({
          abi: EQUIFLOW_VAULT_ABI,
          functionName: "pledgeAndBorrow",
          args: [tokenAddr, shareAmountRaw, borrowUsdScaled],
        }),
      });
      const { txHash } = await sendUserOp({
        smartAccount,
        calls,
        gasMode: "sponsored",
      });
      setAaTxHash(txHash);
      setStage("sealed");
      refetchAllowance();
      refetchBalance();
    } catch (err) {
      setAaError(err instanceof Error ? err.message : String(err));
      setStage("idle");
    }
  };

  const handleApprove = () => {
    if (!tokenAddr) return;
    setStage("approving");
    writeContract({
      abi: ERC20_ABI,
      address: tokenAddr,
      functionName: "approve",
      args: [spender, maxUint256],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  };

  const handleLock = () => {
    if (!tokenAddr || !spender) return;
    resetWrite();
    setStage("locking");
    const borrowUsdScaled =
      borrowUsd > 0 ? parseUnits(borrowUsd.toFixed(18), 18) : 0n;
    writeContract({
      abi: EQUIFLOW_VAULT_ABI,
      address: spender,
      functionName: "pledgeAndBorrow",
      args: [tokenAddr, shareAmountRaw, borrowUsdScaled],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  };

  const handleReset = () => {
    setStage("idle");
    setSharesStr("");
    setBorrowPct(60);
    resetWrite();
    setAaTxHash(null);
    setAaError(null);
  };

  useEffect(() => {
    if (!open) handleReset();
  }, [open, sym]);

  const composing = stage === "idle";
  const busy =
    stage === "approving" || stage === "locking" || stage === "bundling" ||
    writePending || receiptPending;
  const sealed = stage === "sealed";

  useEffect(() => {
    if (!sealed) return;
    const t = setTimeout(() => onClose(), 2000);
    return () => clearTimeout(t);
  }, [sealed, onClose]);

  let ctaLabel: string;
  let ctaAction: (() => void) | null = null;
  let ctaDisabled = false;

  if (!isConnected) {
    ctaLabel = "Connect wallet";
    ctaDisabled = true;
  } else if (!onCorrectChain) {
    ctaLabel = "Switch to Robinhood Chain";
    ctaAction = () => switchChain({ chainId: ROBINHOOD_CHAIN_TESTNET_ID });
  } else if (borrowBelowMinimum) {
    ctaLabel = `Minimum borrow is $${MIN_BORROW_USD}`;
    ctaDisabled = true;
  } else if (borrowExceedsLiquidity) {
    ctaLabel = `Insufficient liquidity — only ${vaultLiquidityDisplay ?? "0"} available`;
    ctaDisabled = true;
  } else if (insufficient) {
    ctaLabel = "Insufficient balance";
    ctaDisabled = true;
  } else if (busy) {
    ctaLabel = stage === "bundling" ? "Bundling…" : stage === "approving" ? "Approving…" : "Locking…";
    ctaDisabled = true;
  } else if (sealed) {
    ctaLabel = "Sealed — pledge another";
    ctaAction = handleReset;
  } else if (aaActive && AA_CONFIGURED) {
    ctaLabel = "Sign once · bundle pledge";
    ctaAction = handleBundle;
  } else if (stage === "lock") {
    ctaLabel = "Lock collateral";
    ctaAction = handleLock;
  } else if (needsApproval || stage === "approve") {
    ctaLabel = "Approve & lock";
    ctaAction = handleApprove;
  } else {
    ctaLabel = "Lock collateral";
    ctaAction = handleLock;
  }

  if (shares <= 0 && !sealed) ctaDisabled = true;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-ink/20"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[420px] bg-paper border-l border-ink overflow-y-auto flex flex-col"
        style={{ animation: "ef-slide-in 0.2s ease-out" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b border-hairline"
          style={{ padding: "16px 20px" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="border border-ink rounded-[2px] flex items-center justify-center bg-paper"
              style={{ width: 36, height: 36 }}
            >
              <AssetLogo sym={s.sym} size={24} />
            </div>
            <div>
              <div className="font-mono font-semibold flex items-center gap-2" style={{ fontSize: 14 }}>
                Pledge {s.sym}
              </div>
              <div className="text-ink-mute flex items-center gap-1.5" style={{ fontSize: 11 }}>
                {s.name} · borrow <VaultSelector compact />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="bg-transparent border-0 text-ink-mute hover:text-ink"
            style={{ fontSize: 20, padding: 4, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Price + balance */}
        <div
          className="border-b border-hairline-soft bg-paper-alt grid grid-cols-2"
          style={{ padding: "12px 20px" }}
        >
          <div>
            <div className="eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>Price</div>
            <div
              className="font-serif font-medium tabular"
              style={{ fontSize: 20, letterSpacing: "-0.02em" }}
            >
              {fmt.usd(livePrice)}
            </div>
          </div>
          <div>
            <div className="eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>Your balance</div>
            <div className="font-mono tabular font-medium" style={{ fontSize: 14 }}>
              {balanceDisplay != null
                ? `${fmt.num(balanceDisplay, balanceDisplay < 1 ? 4 : 2)} ${s.sym}`
                : "—"}
            </div>
          </div>
        </div>

        {/* Shares input */}
        <div style={{ padding: "16px 20px 12px" }}>
          <div className="flex justify-between items-baseline" style={{ marginBottom: 6 }}>
            <span className="eyebrow">Shares to pledge</span>
            <span className="font-mono tabular text-ink-mute" style={{ fontSize: 11 }}>
              ≈ {fmt.usd(collateralUsd, 0)}
            </span>
          </div>
          <div
            className="flex items-center gap-3 px-3.5 py-3 rounded-[2px]"
            style={{ border: `1.4px solid ${insufficient ? "var(--down)" : "var(--ink)"}` }}
          >
            <input
              type="number"
              value={sharesStr}
              onChange={(e) => composing && setSharesStr(e.target.value)}
              disabled={!composing}
              placeholder="0"
              className="flex-1 bg-transparent outline-none font-serif font-medium tracking-tight"
              style={{ fontSize: 22, border: "none" }}
            />
            <span className="font-mono text-ink-soft" style={{ fontSize: 13 }}>
              {s.sym}
            </span>
          </div>
          {insufficient && (
            <div
              className="font-mono mt-2 rounded-[2px]"
              style={{
                fontSize: 10,
                padding: "5px 8px",
                background: "var(--down-soft)",
                color: "var(--down)",
                border: "1px solid var(--down)",
              }}
            >
              Exceeds your balance of {fmt.num(balanceDisplay ?? 0, balanceDisplay != null && balanceDisplay < 1 ? 4 : 2)} {s.sym}.
              Get tokens from faucet or reduce amount.
            </div>
          )}
          {live && balanceDisplay != null && balanceDisplay > 0 && (
            <div className="flex gap-1.5 mt-2">
              {[0.25, 0.5, 1].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => composing && setSharesStr((Math.floor(balanceDisplay * p * 1e4) / 1e4).toString())}
                  className="px-2 py-1 border border-hairline rounded-[2px] font-mono hover:border-ink transition-colors"
                  style={{ fontSize: 10 }}
                  disabled={!composing}
                >
                  {p === 1 ? "MAX" : `${p * 100}%`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Borrow slider */}
        <div style={{ padding: "0 20px 16px" }}>
          <div className="flex justify-between items-baseline" style={{ marginBottom: 6 }}>
            <span className="eyebrow">Borrow {borrowPct}%</span>
            <span className="font-mono tabular text-ink-mute" style={{ fontSize: 11 }}>
              LTV {(s.ltv * 100).toFixed(0)}% cap
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={borrowPct}
            disabled={!composing}
            onChange={(e) => setBorrowPct(+e.target.value)}
            className="w-full cursor-pointer"
          />
          {borrowBelowMinimum && (
            <div
              className="font-mono mt-2 rounded-[2px]"
              style={{
                fontSize: 10,
                padding: "5px 8px",
                background: "var(--down-soft)",
                color: "var(--down)",
                border: "1px solid var(--down)",
              }}
            >
              Minimum borrow is ${MIN_BORROW_USD}. Increase collateral or set borrow to 0%.
            </div>
          )}
          {borrowExceedsLiquidity && (
            <div
              className="font-mono mt-2 rounded-[2px]"
              style={{
                fontSize: 10,
                padding: "5px 8px",
                background: "var(--down-soft)",
                color: "var(--down)",
                border: "1px solid var(--down)",
              }}
            >
              Vault only has {vaultLiquidityDisplay ?? "0"} available.
              Reduce borrow or deposit LP first.
            </div>
          )}
          <div className="flex justify-between items-end mt-2">
            <span className="font-mono tabular" style={{ fontSize: 11 }}>You receive</span>
            <div className="text-right">
              {isWethVault && borrowTokenAmount != null ? (
                <>
                  <div className="font-serif tabular font-medium" style={{ fontSize: 18, letterSpacing: "-0.02em" }}>
                    {borrowTokenAmount < 0.001 && borrowTokenAmount > 0
                      ? borrowTokenAmount.toFixed(6)
                      : borrowTokenAmount.toFixed(4)} WETH
                  </div>
                  <div className="font-mono tabular text-ink-mute" style={{ fontSize: 10 }}>
                    ≈ {fmt.usd(borrowUsd, 2)}
                  </div>
                </>
              ) : (
                <div className="font-serif tabular font-medium" style={{ fontSize: 18, letterSpacing: "-0.02em" }}>
                  {fmt.usd(borrowUsd, 2)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div
          className="border-t border-hairline-soft"
          style={{ padding: "12px 20px" }}
        >
          <div className="eyebrow" style={{ marginBottom: 6 }}>Position preview</div>
          {([
            ["Collateral", fmt.usd(collateralUsd, 0)],
            ["LTV", ltvActual > 0 ? `${ltvActual.toFixed(1)}% / ${(s.ltv * 100).toFixed(0)}% cap` : "—"],
            ["Health factor", healthFactor > 10 ? "∞" : healthFactor.toFixed(2)],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between py-1.5" style={{ fontSize: 12 }}>
              <span className="text-ink-soft">{k}</span>
              <span className="font-mono tabular font-medium">{v}</span>
            </div>
          ))}
        </div>

        {/* Errors */}
        {writeError && (
          <div className="mx-5 mb-2 text-down font-mono rounded-[2px]" style={{ fontSize: 10, padding: "6px 10px", background: "var(--down-soft)", border: "1px solid var(--down)" }}>
            {writeError.message.slice(0, 160)}
          </div>
        )}
        {aaError && (
          <div className="mx-5 mb-2 text-down font-mono rounded-[2px]" style={{ fontSize: 10, padding: "6px 10px", background: "var(--down-soft)", border: "1px solid var(--down)" }}>
            {aaError.slice(0, 160)}
          </div>
        )}

        {/* Sealed */}
        {sealed && (
          <div className="mx-5 mb-2 font-mono rounded-[2px]" style={{ fontSize: 11, padding: "8px 12px", background: "var(--up-soft)", color: "var(--up)", border: "1px solid var(--up)" }}>
            Pledged {shares} {s.sym} · borrowed {fmt.usd(borrowUsd, 2)} {vault.borrowSymbol}
          </div>
        )}

        {/* CTA */}
        <div style={{ padding: "12px 20px 20px", marginTop: "auto" }}>
          <button
            type="button"
            onClick={() => { if (ctaAction && !ctaDisabled) ctaAction(); }}
            disabled={ctaDisabled || !ctaAction}
            className="w-full px-5 py-3.5 border border-ink rounded-[2px] font-medium"
            style={{
              fontSize: 13,
              background: sealed ? "var(--paper)" : "var(--ink)",
              color: sealed ? "var(--ink)" : "var(--paper)",
              opacity: ctaDisabled ? 0.5 : 1,
              cursor: ctaDisabled ? "not-allowed" : "pointer",
            }}
          >
            {ctaLabel}
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes ef-slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
