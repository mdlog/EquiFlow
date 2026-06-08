"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  ERC20_ABI,
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  explorerAddr,
  shortAddr,
} from "@/lib/contracts";
import { findStock, stockAddress, isLive } from "@/lib/config/stocks";
import { useStockPrice } from "@/lib/hooks/use-adapter-price";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { fmt } from "@/lib/format";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import { sendUserOp } from "@/lib/aa/send-userop";
import { AA_CONFIGURED } from "@/lib/web3/alchemy";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import {
  useListedAssets,
  useProtocolStats,
} from "@/lib/hooks/use-protocol-stats";
import { usePosition } from "@/lib/hooks/use-position";
import { useMarketStatus } from "@/lib/hooks/use-market-status";
import {
  isBorrowBlockedByMarket,
  isMarketTradingClosed,
  marketStatusLabel,
} from "@/lib/web3/market-hours";
import { VaultSelector } from "@/components/VaultSelector";
import { AssetLogo } from "@/components/AssetLogo";
import { HealthFactorMeter } from "@/components/HealthFactorMeter";
import { useEthPrice } from "@/lib/hooks/use-eth-price";
import { parseAmount, usdToE18Safe } from "@/lib/utils/bigint";
import { friendlyError } from "@/lib/utils/error";
import {
  txErrorToast,
  txPendingToast,
  txSealedToast,
} from "@/lib/utils/tx-toast";
import { qkMatches } from "@/lib/hooks/query-keys";

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
  const queryClient = useQueryClient();
  const pos = usePosition();

  const titleId = useId();
  const sharesId = useId();
  const sharesHelperId = useId();
  const borrowId = useId();
  const errorId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

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
  const [toastId, setToastId] = useState<string | number | null>(null);

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

  // Tier-2 market-hours gate: read on-chain marketStatus so we can disable
  // borrowing (and explain it) instead of letting the wallet fail to estimate
  // gas on a tx that reverts with `MarketClosed`. Pure deposits stay allowed.
  const market = useMarketStatus([tokenAddr], spender);
  const marketClosed = isMarketTradingClosed(market.primaryStatus);

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
  // Only the borrow leg is gated — a deposit-only pledge (borrow 0%) still works
  // while the market is closed, so we steer the user there rather than blocking.
  const borrowBlockedByMarket = isBorrowBlockedByMarket(
    market.primaryStatus,
    borrowUsd,
  );

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

  // String-first parsing avoids ~1 wei drift on free-form shares like "0.11"
  // that would let the user pledge more than their balance.
  const shareAmountRaw = useMemo(() => {
    if (!sharesStr.trim()) return 0n;
    return parseAmount(sharesStr, dec);
  }, [sharesStr, dec]);

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
      // Resolve the orphaned "Approve …" toast the moment the receipt lands.
      // Without this, sonner keeps the loading spinner on `duration: Infinity`
      // forever even though the chain has already confirmed the approval —
      // the user sees "approve notif loading lama" while we silently transition
      // to the lock step. Stamp it sealed, then null the id so the next
      // handleLock spawns a fresh pending toast for the pledge tx.
      if (toastId !== null) {
        txSealedToast(toastId, {
          action: `Approved ${shares} ${s.sym}`,
          txHash,
        });
        setToastId(null);
      }
      resetWrite();
      refetchAllowance().then(() => setStage("lock"));
    } else if (stage === "locking") {
      setStage("sealed");
      refetchBalance();
    }
  }, [
    receiptSuccess,
    stage,
    resetWrite,
    refetchAllowance,
    refetchBalance,
    toastId,
    shares,
    s.sym,
    txHash,
  ]);

  const [aaTxHash, setAaTxHash] = useState<Hex | null>(null);
  const [aaError, setAaError] = useState<string | null>(null);

  const handleBundle = async () => {
    if (!tokenAddr || !spender || !smartAccount) return;
    setAaError(null);
    setStage("bundling");
    const id = txPendingToast({
      action: `Pledge ${shares} ${s.sym} (sponsored)`,
    });
    setToastId(id);
    try {
      await prepareForSubmit();
      const borrowUsdScaled = usdToE18Safe(borrowUsd);
      const calls = [];
      // Approve exactly what this UserOp will pull — never maxUint256. If a
      // future upgrade introduces an admin escape hatch, an outstanding
      // unlimited approval would let it drain the user's full balance.
      if (allowance === undefined || shareAmountRaw > (allowance as bigint)) {
        calls.push({
          to: tokenAddr,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [spender, shareAmountRaw],
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
      setAaError(friendlyError(err));
      txErrorToast(id, err);
      setStage("idle");
    }
  };

  const handleApprove = () => {
    if (!tokenAddr) return;
    setStage("approving");
    const id = txPendingToast({ action: `Approve ${shares} ${s.sym}` });
    setToastId(id);
    // Exact-amount approval — see comment in handleBundle.
    writeContract({
      abi: ERC20_ABI,
      address: tokenAddr,
      functionName: "approve",
      args: [spender, shareAmountRaw],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  };

  const handleLock = () => {
    if (!tokenAddr || !spender) return;
    resetWrite();
    setStage("locking");
    const id = txPendingToast({
      action: `Pledge ${shares} ${s.sym} · borrow ${fmt.usd(borrowUsd, 2)}`,
    });
    setToastId(id);
    const borrowUsdScaled = usdToE18Safe(borrowUsd);
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
    setToastId(null);
    resetWrite();
    setAaTxHash(null);
    setAaError(null);
  };

  useEffect(() => {
    if (!open) handleReset();
    // sym is intentionally not in deps — sym change closes the sidebar via parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lock body scroll, focus-trap, restore focus on close — same a11y contract
  // ModalShell honours for the other tx modals.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const id = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const closeBtn = panel.querySelector<HTMLElement>(
        '[data-modal-close="true"]',
      );
      (closeBtn ?? panel).focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.cancelAnimationFrame(id);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  const composing = stage === "idle";
  const busy =
    stage === "approving" || stage === "locking" || stage === "bundling" ||
    writePending || receiptPending;
  const sealed = stage === "sealed";

  useEffect(() => {
    if (!sealed) return;
    if (toastId !== null) {
      txSealedToast(toastId, {
        action: `Pledged ${shares} ${s.sym}`,
        txHash: aaTxHash ?? txHash,
      });
    }
    queryClient.invalidateQueries({
      predicate: (q) => qkMatches.postTx(q.queryKey),
    });
    queryClient.invalidateQueries({ queryKey: ["wagmi"] });
    const t = setTimeout(() => onClose(), 2000);
    return () => clearTimeout(t);
  }, [
    sealed,
    onClose,
    toastId,
    shares,
    s.sym,
    aaTxHash,
    txHash,
    queryClient,
  ]);

  useEffect(() => {
    if (!writeError) return;
    if (toastId !== null) txErrorToast(toastId, writeError);
  }, [writeError, toastId]);

  const oracleStale = pos.oracleStale;

  let ctaLabel: string;
  let ctaAction: (() => void) | null = null;
  let ctaDisabled = false;

  if (!isConnected) {
    ctaLabel = "Connect wallet";
    ctaDisabled = true;
  } else if (!onCorrectChain) {
    ctaLabel = "Switch to Robinhood Chain";
    ctaAction = () => switchChain({ chainId: ROBINHOOD_CHAIN_TESTNET_ID });
  } else if (oracleStale) {
    ctaLabel = "Wait for next keeper tick";
    ctaDisabled = true;
  } else if (borrowBlockedByMarket) {
    // Market closed: the borrow leg would revert with MarketClosed. Disable the
    // CTA so the tx never fires (no cryptic "Missing gas limit" from the wallet
    // failing to estimate a reverting call) and steer to the deposit-only path.
    ctaLabel = "Market closed — set borrow to 0% to deposit";
    ctaDisabled = true;
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
    // EOA flow, after the approve tx confirmed — this is the second of two
    // separate transactions (an EOA can't atomically bundle approve + lock).
    ctaLabel = "Lock collateral · step 2 of 2";
    ctaAction = handleLock;
  } else if (needsApproval || stage === "approve") {
    // EOA flow, first of two txs: approve only. Labelled as step 1/2 so it's
    // clear another signature (the lock) follows. Bundling into one signature
    // is only possible with the smart wallet (see the aaActive branch above).
    ctaLabel = "Approve · step 1 of 2";
    ctaAction = handleApprove;
  } else {
    // Allowance already sufficient — a single lock tx, no separate approve.
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
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
              <div
                id={titleId}
                className="font-mono font-semibold flex items-center gap-2"
                style={{ fontSize: 14 }}
              >
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
            aria-label="Close pledge sidebar"
            data-modal-close="true"
            className="bg-transparent border-0 text-ink-mute hover:text-ink"
            style={{ fontSize: 20, padding: 4, lineHeight: 1 }}
          >
            <span aria-hidden="true">×</span>
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
            <label htmlFor={sharesId} className="eyebrow">
              Shares to pledge
            </label>
            <span
              id={sharesHelperId}
              className="font-mono tabular text-ink-mute"
              style={{ fontSize: 11 }}
            >
              ≈ {fmt.usd(collateralUsd, 0)}
            </span>
          </div>
          <div
            className="flex items-center gap-3 px-3.5 py-3 rounded-[2px]"
            style={{ border: `1.4px solid ${insufficient ? "var(--down)" : "var(--ink)"}` }}
          >
            <input
              id={sharesId}
              type="number"
              value={sharesStr}
              onChange={(e) => composing && setSharesStr(e.target.value)}
              disabled={!composing}
              placeholder="0"
              aria-describedby={`${sharesHelperId} ${errorId}`}
              aria-invalid={insufficient || oracleStale || undefined}
              className="flex-1 bg-transparent outline-none font-serif font-medium tracking-tight"
              style={{ fontSize: 22, border: "none" }}
            />
            <span className="font-mono text-ink-soft" style={{ fontSize: 13 }}>
              {s.sym}
            </span>
          </div>
          {insufficient && (
            <div
              id={errorId}
              role="alert"
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
          {oracleStale && (
            <div
              role="alert"
              className="font-mono mt-2 rounded-[2px]"
              style={{
                fontSize: 10,
                padding: "5px 8px",
                background: "var(--down-soft)",
                color: "var(--down)",
                border: "1px solid var(--down)",
              }}
            >
              Oracle price is stale — wait for the next keeper tick.
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
          {marketClosed && (
            <div
              role="status"
              className="font-mono rounded-[2px]"
              style={{
                fontSize: 10,
                padding: "7px 9px",
                marginBottom: 10,
                background: "var(--amber-soft)",
                color: "var(--amber)",
                border: "1px solid var(--amber)",
                lineHeight: 1.45,
              }}
            >
              <span style={{ fontWeight: 600 }}>
                {marketStatusLabel(market.primaryStatus)}.
              </span>{" "}
              Borrowing against {s.sym} is paused while its market is shut — the
              oracle price is frozen at the last close. You can still deposit
              collateral now and borrow once it reopens.
              {composing && borrowPct > 0 && (
                <button
                  type="button"
                  onClick={() => setBorrowPct(0)}
                  className="block mt-1.5 underline"
                  style={{ color: "var(--amber)", fontSize: 10 }}
                >
                  Switch to deposit-only →
                </button>
              )}
            </div>
          )}
          <div className="flex justify-between items-baseline" style={{ marginBottom: 6 }}>
            <label htmlFor={borrowId} className="eyebrow">
              Borrow {borrowPct}%
            </label>
            <span className="font-mono tabular text-ink-mute" style={{ fontSize: 11 }}>
              LTV {(s.ltv * 100).toFixed(0)}% cap
            </span>
          </div>
          <input
            id={borrowId}
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
              role="alert"
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
              role="alert"
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
          <div className="flex justify-between py-1.5" style={{ fontSize: 12 }}>
            <span className="text-ink-soft">Collateral</span>
            <span className="font-mono tabular font-medium">{fmt.usd(collateralUsd, 0)}</span>
          </div>
          <div className="flex justify-between py-1.5" style={{ fontSize: 12 }}>
            <span className="text-ink-soft">LTV</span>
            <span className="font-mono tabular font-medium">
              {ltvActual > 0 ? `${ltvActual.toFixed(1)}% / ${(s.ltv * 100).toFixed(0)}% cap` : "—"}
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <HealthFactorMeter before={Infinity} after={healthFactor} />
          </div>
        </div>

        {/* Errors */}
        {writeError && (
          <div className="mx-5 mb-2 text-down font-mono rounded-[2px]" style={{ fontSize: 10, padding: "6px 10px", background: "var(--down-soft)", border: "1px solid var(--down)" }}>
            {friendlyError(writeError)?.slice(0, 160)}
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
            aria-busy={busy ? true : undefined}
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
          {vault.address && (
            <div
              className="font-mono text-center"
              style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 8 }}
            >
              Contract ·{" "}
              <a
                href={explorerAddr(vault.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-mute hover:text-ink no-underline"
              >
                {shortAddr(vault.address)} ↗
              </a>
            </div>
          )}
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
