"use client";

import { useEffect, useState } from "react";
import { type Address, type Hex, encodeFunctionData, parseUnits } from "viem";
import {
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  EQUIFLOW_VAULT_ABI,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { fmt } from "@/lib/format";
import type { LiveCollateralLine } from "@/lib/hooks/use-position";
import { useActiveWallet } from "@/lib/hooks/use-active-wallet";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import { sendUserOp } from "@/lib/aa/send-userop";
import { AA_CONFIGURED } from "@/lib/web3/alchemy";
import {
  ModalActions,
  ModalFootnote,
  ModalShell,
  PreviewRow,
  SealedMessage,
  SumRow,
  TxError,
  TxLink,
  ValidationError,
} from "./modal";

/// Pure-borrow modal: calls EquiFlowVault.pledgeAndBorrow(token, 0, borrowUsd)
/// so the user can draw additional stablecoin against already-locked collateral
/// without re-pledging.
///
/// Contract supports `amount=0, borrowUsd>0` and re-enforces LTV cap — if the
/// requested borrow would exceed the cap, the tx reverts with `ExceedsLtv`.

interface Props {
  open: boolean;
  onClose: () => void;
  lines: LiveCollateralLine[];
  collateralUsd: number;
  borrowedUsd: number;
  ltvCap: number; // percent, e.g. 55
  liqLtv: number; // percent, e.g. 63 — from vault.liquidationThresholdBps()
}

export function BorrowMoreModal({
  open,
  onClose,
  lines,
  collateralUsd,
  borrowedUsd,
  ltvCap,
  liqLtv,
}: Props) {
  const { vault } = useVaultContext();
  const VAULT_ADDR = vault.address;
  const TOKEN_ADDR = vault.tokenAddress;
  const tokenSymbol = vault.borrowSymbol;

  const { isConnected } = useActiveWallet();
  const { mode: aaMode, smartAccount, prepareForSubmit } = useSmartWallet();
  const aaActive = aaMode !== "off" && smartAccount != null;
  const [amountStr, setAmountStr] = useState("");
  const headroom = Math.max(0, collateralUsd * (ltvCap / 100) - borrowedUsd);
  const amount = Math.max(0, Number(amountStr) || 0);
  const newBorrowed = borrowedUsd + amount;
  const newLtv = collateralUsd > 0 ? (newBorrowed / collateralUsd) * 100 : 0;
  const newHf = newLtv > 0 ? liqLtv / newLtv : Infinity;
  const overCap = amount > headroom + 0.001;

  const tokenSym = lines[0]?.sym;
  const tokenAddr = tokenSym ? STOCK_TOKEN_ADDRESSES[tokenSym] : undefined;

  const { writeContract, data: txHash, isPending, error, reset } =
    useWriteContract();
  const { isLoading: mining, isSuccess: eoaSealed } =
    useWaitForTransactionReceipt({
      hash: txHash,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });

  const [aaTxHash, setAaTxHash] = useState<Hex | null>(null);
  const [aaError, setAaError] = useState<string | null>(null);
  const [aaBusy, setAaBusy] = useState(false);
  const sealed = eoaSealed || aaTxHash != null;

  useEffect(() => {
    if (!open) {
      setAmountStr("");
      setAaTxHash(null);
      setAaError(null);
      setAaBusy(false);
      reset();
    }
  }, [open, reset]);

  const canBorrow =
    isConnected &&
    !!tokenAddr &&
    !!VAULT_ADDR &&
    amount > 0 &&
    !overCap &&
    !isPending &&
    !mining &&
    !aaBusy &&
    !sealed;

  function handleBorrow() {
    if (!tokenAddr || !VAULT_ADDR) return;
    const borrowUsd = parseUnits(amount.toFixed(18), 18);
    if (aaActive && smartAccount && AA_CONFIGURED) {
      void handleBundle(borrowUsd);
      return;
    }
    writeContract({
      abi: EQUIFLOW_VAULT_ABI,
      address: VAULT_ADDR,
      functionName: "pledgeAndBorrow",
      args: [tokenAddr, 0n, borrowUsd],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  }

  async function handleBundle(borrowUsd: bigint) {
    if (!tokenAddr || !VAULT_ADDR || !smartAccount) return;
    setAaError(null);
    setAaBusy(true);
    try {
      await prepareForSubmit();
      const { txHash: hash } = await sendUserOp({
        smartAccount,
        calls: [
          {
            to: VAULT_ADDR as Address,
            data: encodeFunctionData({
              abi: EQUIFLOW_VAULT_ABI,
              functionName: "pledgeAndBorrow",
              args: [tokenAddr, 0n, borrowUsd],
            }),
          },
        ],
        gasMode: "sponsored",
      });
      setAaTxHash(hash);
    } catch (err) {
      console.error("[BorrowMoreModal] UserOp failed:", err);
      setAaError(err instanceof Error ? err.message : String(err));
    } finally {
      setAaBusy(false);
    }
  }

  let ctaLabel: string;
  if (!isConnected) ctaLabel = "Connect wallet";
  else if (!tokenAddr) ctaLabel = "No collateral asset";
  else if (aaBusy) ctaLabel = "Bundling sponsored UserOp…";
  else if (isPending) ctaLabel = "Sign in wallet…";
  else if (mining) ctaLabel = "Borrowing…";
  else if (aaActive) ctaLabel = `Sign borrow (sponsored) · ${fmt.usd(amount, 2)}`;
  else ctaLabel = `Sign borrow · ${fmt.usd(amount, 2)}`;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      eyebrow="Pure borrow · pledgeAndBorrow(0)"
      title="Borrow more"
      footer={
        <>
          {overCap && (
            <ValidationError>
              Exceeds LTV cap. Reduce amount or add collateral first.
            </ValidationError>
          )}
          <TxError message={aaError ?? error?.message} />
          <TxLink hash={aaTxHash ?? txHash} />
          {sealed && (
            <SealedMessage>
              Borrowed {fmt.usd(amount, 2)} {tokenSymbol} · refresh position to see update
            </SealedMessage>
          )}
          <ModalActions
            onClose={onClose}
            sealed={sealed}
            cta={{
              label: ctaLabel,
              onClick: handleBorrow,
              disabled: !canBorrow,
            }}
          />
          <ModalFootnote>
            Calls{" "}
            <span className="font-mono">
              pledgeAndBorrow({tokenSym ?? "—"}, 0, {fmt.usd(amount, 2)})
            </span>{" "}
            on EquiFlowVault
          </ModalFootnote>
        </>
      }
    >
      {/* Summary */}
      <div
        className="border-b border-hairline-soft bg-paper-alt"
        style={{ padding: "14px 24px" }}
      >
        <SumRow k="Collateral locked" v={fmt.usd(collateralUsd, 2)} />
        <SumRow k="Current debt" v={fmt.usd(borrowedUsd, 2)} />
        <SumRow
          k="Available headroom"
          v={fmt.usd(headroom, 2)}
          color="var(--up)"
        />
      </div>

      {/* Input */}
      <div style={{ padding: "18px 24px 12px" }}>
        <div
          className="flex justify-between items-baseline"
          style={{ marginBottom: 8 }}
        >
          <span className="eyebrow">Amount to borrow</span>
          <span
            className="font-mono text-ink-mute tabular"
            style={{ fontSize: 10 }}
          >
            max {fmt.usd(headroom, 2)}
          </span>
        </div>
        <div
          className="flex items-center gap-2 bg-paper rounded-[2px]"
          style={{
            padding: "12px 14px",
            border: `1.4px solid ${overCap ? "var(--down)" : "var(--ink)"}`,
          }}
        >
          <span className="font-mono text-ink-mute" style={{ fontSize: 14 }}>
            $
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            max={headroom}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={!isConnected || mining || isPending}
            placeholder="0.00"
            className="font-serif font-medium tabular bg-transparent border-0 outline-none flex-1 w-full min-w-0"
            style={{ fontSize: 22, letterSpacing: "-0.02em" }}
          />
          <span className="font-mono text-ink-soft" style={{ fontSize: 13 }}>
            {tokenSymbol}
          </span>
        </div>
        <div className="flex gap-1.5 mt-2.5">
          {[0.25, 0.5, 0.75, 1].map((frac) => (
            <button
              key={frac}
              type="button"
              onClick={() => setAmountStr((headroom * frac).toFixed(2))}
              disabled={!isConnected || headroom <= 0}
              className="bg-transparent border border-hairline rounded-[2px] hover:border-ink transition-colors"
              style={{ padding: "4px 9px", fontSize: 10 }}
            >
              {frac === 1 ? "MAX" : `${frac * 100}%`}
            </button>
          ))}
        </div>
      </div>

      {/* Preview after borrow */}
      <div
        className="border-t border-hairline-soft"
        style={{ padding: "12px 24px 14px" }}
      >
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          After borrow
        </div>
        <PreviewRow k="Debt becomes" v={fmt.usd(newBorrowed, 2)} />
        <PreviewRow
          k="LTV"
          v={`${newLtv.toFixed(1)}% / ${ltvCap.toFixed(0)}% cap`}
          color={
            overCap
              ? "var(--down)"
              : newLtv / ltvCap > 0.85
                ? "var(--amber)"
                : "var(--ink)"
          }
        />
        <PreviewRow
          k="Health factor"
          v={newHf > 99 ? "∞" : newHf.toFixed(2)}
          color={
            newHf > 2.5
              ? "var(--up)"
              : newHf > 1.5
                ? "var(--amber)"
                : "var(--down)"
          }
        />
      </div>
    </ModalShell>
  );
}
