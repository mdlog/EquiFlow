"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { type Address, type Hex, encodeFunctionData, parseUnits } from "viem";
import {
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  EQUIFLOW_VAULT_ABI,
  STOCK_TOKEN_ADDRESSES,
} from "@/lib/contracts";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import { usePosition } from "@/lib/hooks/use-position";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { fmt } from "@/lib/format";
import { useStockPrices } from "@/lib/hooks/use-adapter-price";
import type { LiveCollateralLine } from "@/lib/hooks/use-position";
import { useActiveWallet } from "@/lib/hooks/use-active-wallet";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import { sendUserOp } from "@/lib/aa/send-userop";
import { AA_CONFIGURED } from "@/lib/web3/alchemy";
import { parseAmount } from "@/lib/utils/bigint";
import { friendlyError } from "@/lib/utils/error";
import {
  txErrorToast,
  txPendingToast,
  txSealedToast,
} from "@/lib/utils/tx-toast";
import { qkMatches } from "@/lib/hooks/query-keys";
import { HealthFactorMeter } from "@/components/HealthFactorMeter";
import {
  ContractTrustLine,
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

/// Withdraw collateral modal: calls EquiFlowVault.withdraw(token, amount).
/// Contract reverts with `ExceedsLtv` if the withdrawal would push the
/// remaining position over the LTV cap. UI pre-validates so the user can
/// see max withdrawable before signing.

interface Props {
  open: boolean;
  onClose: () => void;
  lines: LiveCollateralLine[];
  collateralUsd: number;
  borrowedUsd: number;
  ltvCap: number; // percent, e.g. 55
  liqLtv: number; // percent — from vault.liquidationThresholdBps()
}

export function WithdrawCollateralModal({
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
  const tokenSymbol = vault.borrowSymbol;

  const { isConnected } = useActiveWallet();
  const { mode: aaMode, smartAccount, prepareForSubmit } =
    useSmartWallet();
  const aaActive = aaMode !== "off" && smartAccount != null;
  const prices = useStockPrices();
  const pos = usePosition();
  const queryClient = useQueryClient();

  const sharesId = useId();
  const helperId = useId();
  const errorId = useId();

  const [selectedSym, setSelectedSym] = useState<string>(lines[0]?.sym ?? "");
  const [sharesStr, setSharesStr] = useState("");
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);
  const [toastId, setToastId] = useState<string | number | null>(null);

  useEffect(() => {
    const first = lines[0];
    if (open && first) setSelectedSym(first.sym);
  }, [open, lines]);

  const line = lines.find((l) => l.sym === selectedSym);
  const livePrice = prices[selectedSym]?.price ?? 0;
  const tokenAddr = selectedSym ? STOCK_TOKEN_ADDRESSES[selectedSym] : undefined;

  const shares = Math.max(0, Number(sharesStr) || 0);
  const withdrawUsd = shares * livePrice;

  // Solve for maximum withdraw value that keeps LTV ≤ cap.
  const minCollatRequired = ltvCap > 0 ? borrowedUsd / (ltvCap / 100) : 0;
  const maxWithdrawUsd = Math.max(0, collateralUsd - minCollatRequired);
  const lineValue = useMemo(
    () => (line ? livePrice * line.shares : 0),
    [line, livePrice],
  );
  const maxShares =
    livePrice > 0
      ? Math.min(line?.shares ?? 0, maxWithdrawUsd / livePrice)
      : 0;

  const newCollateralUsd = collateralUsd - withdrawUsd;
  const newLtv =
    newCollateralUsd > 0 ? (borrowedUsd / newCollateralUsd) * 100 : 0;
  const newHf =
    newLtv > 0 ? liqLtv / newLtv : Number.POSITIVE_INFINITY;
  const currentHf =
    borrowedUsd > 0 && collateralUsd > 0
      ? liqLtv / ((borrowedUsd / collateralUsd) * 100)
      : Number.POSITIVE_INFINITY;
  const overCap = withdrawUsd > maxWithdrawUsd + 0.001;
  const overBalance = line ? shares > line.shares + 1e-9 : false;
  const invalid = overCap || overBalance;
  // Trip the safety checkbox once projected HF dips below 1.5 — the user is
  // either flying close to the cap or moving into the amber band.
  const requiresAck = shares > 0 && Number.isFinite(newHf) && newHf < 1.5;

  const { writeContract, data: txHash, isPending, error, reset } =
    useWriteContract();
  const { isLoading: mining, isSuccess: eoaSealed } =
    useWaitForTransactionReceipt({
      hash: txHash,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });

  // AA-mode side state — UserOp doesn't go through wagmi's tx tracking, so
  // we record success/error locally.
  const [aaTxHash, setAaTxHash] = useState<Hex | null>(null);
  const [aaError, setAaError] = useState<string | null>(null);
  const [aaBusy, setAaBusy] = useState(false);
  const sealed = eoaSealed || aaTxHash != null;
  const busy = isPending || mining || aaBusy;

  useEffect(() => {
    if (!open) {
      setSharesStr("");
      setAcknowledgeRisk(false);
      setAaTxHash(null);
      setAaError(null);
      setAaBusy(false);
      setToastId(null);
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (!sealed) return;
    if (toastId !== null) {
      txSealedToast(toastId, {
        action: `Withdraw ${shares} ${selectedSym}`,
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
    selectedSym,
    aaTxHash,
    txHash,
    queryClient,
  ]);

  useEffect(() => {
    if (!error) return;
    if (toastId !== null) txErrorToast(toastId, error);
  }, [error, toastId]);

  const oracleStale = pos.oracleStale;
  const showAckGate = requiresAck && !acknowledgeRisk;

  const canWithdraw =
    isConnected &&
    !!tokenAddr &&
    !!VAULT_ADDR &&
    shares > 0 &&
    !invalid &&
    !oracleStale &&
    !showAckGate &&
    !busy &&
    !sealed;

  function handleWithdraw() {
    if (!tokenAddr || !VAULT_ADDR || !line) return;
    // Use the raw on-chain balance when the user is withdrawing their full
    // position. `parseUnits(shares.toFixed(18), 18)` drifts by ~1 wei on
    // non-exactly-representable decimals (e.g. 0.11), and the vault rejects
    // with `InsufficientCollateral()` even at +1 wei past the balance.
    const fullWithdraw = Math.abs(shares - line.shares) < 1e-9;
    const amount = fullWithdraw
      ? line.sharesRaw
      : sharesStr.trim().length > 0
        ? parseAmount(sharesStr, 18)
        : parseUnits(shares.toFixed(18), 18);
    if (amount <= 0n) return;
    const id = txPendingToast({
      action: `Withdraw ${shares} ${selectedSym}${aaActive ? " (sponsored)" : ""}`,
    });
    setToastId(id);
    if (aaActive && smartAccount && AA_CONFIGURED) {
      void handleBundle(amount, id);
      return;
    }
    writeContract({
      abi: EQUIFLOW_VAULT_ABI,
      address: VAULT_ADDR,
      functionName: "withdraw",
      args: [tokenAddr, amount],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  }

  async function handleBundle(amount: bigint, id: string | number) {
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
              functionName: "withdraw",
              args: [tokenAddr, amount],
            }),
          },
        ],
        gasMode: "sponsored",
      });
      setAaTxHash(hash);
    } catch (err) {
      console.error("[WithdrawCollateralModal] UserOp failed:", err);
      setAaError(friendlyError(err));
      txErrorToast(id, err);
    } finally {
      setAaBusy(false);
    }
  }

  let ctaLabel: string;
  if (!isConnected) ctaLabel = "Connect wallet";
  else if (!tokenAddr) ctaLabel = "Token not configured";
  else if (oracleStale) ctaLabel = "Wait for next keeper tick";
  else if (aaBusy) ctaLabel = "Bundling sponsored UserOp…";
  else if (isPending) ctaLabel = "Sign in wallet…";
  else if (mining) ctaLabel = "Withdrawing…";
  else if (aaActive)
    ctaLabel = `Sign withdraw (sponsored) · ${shares > 0 ? shares.toFixed(4) : "0"} ${selectedSym}`;
  else
    ctaLabel = `Sign withdraw · ${shares > 0 ? shares.toFixed(4) : "0"} ${selectedSym}`;

  const hasInputError = overCap || overBalance || oracleStale;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      eyebrow="withdraw(token, amount) · LTV re-checked"
      title="Withdraw collateral"
      footer={
        <>
          {overCap && (
            <ValidationError id={errorId}>
              Withdrawal would breach LTV cap. Reduce amount or repay debt first.
            </ValidationError>
          )}
          {overBalance && (
            <ValidationError>
              Exceeds your locked balance ({line?.shares} {selectedSym}).
            </ValidationError>
          )}
          {oracleStale && (
            <ValidationError>
              Oracle price is stale — wait for the next keeper tick.
            </ValidationError>
          )}
          <TxError message={aaError ?? friendlyError(error)} />
          <TxLink hash={aaTxHash ?? txHash} />
          {sealed && (
            <SealedMessage>
              Unlocked {shares} {selectedSym} · refresh position to see update
            </SealedMessage>
          )}
          {requiresAck && (
            <label
              className="flex items-start gap-2 text-ink-soft"
              style={{ fontSize: 11, lineHeight: 1.4 }}
            >
              <input
                type="checkbox"
                checked={acknowledgeRisk}
                onChange={(e) => setAcknowledgeRisk(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                I understand this brings me closer to liquidation (new HF{" "}
                <span className="font-mono">{newHf.toFixed(2)}</span>).
              </span>
            </label>
          )}
          <ModalActions
            onClose={onClose}
            sealed={sealed}
            cta={{
              label: ctaLabel,
              onClick: handleWithdraw,
              disabled: !canWithdraw,
              busy,
            }}
          />
          <ContractTrustLine address={VAULT_ADDR} />
          <ModalFootnote>
            Calls{" "}
            <span className="font-mono">
              withdraw({selectedSym}, {shares.toFixed(4)})
            </span>{" "}
            on EquiFlowVault. Locked value: {fmt.usd(lineValue, 2)}.
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
          k="Max withdrawable (LTV-safe)"
          v={fmt.usd(maxWithdrawUsd, 2)}
          color="var(--up)"
        />
      </div>

      {/* Asset picker */}
      {lines.length > 1 && (
        <div
          className="border-b border-hairline-soft"
          style={{ padding: "12px 24px" }}
        >
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Asset
          </div>
          <div
            className="flex gap-1 flex-wrap"
            role="radiogroup"
            aria-label="Collateral asset to withdraw"
          >
            {lines.map((l) => {
              const isSelected = l.sym === selectedSym;
              return (
                <button
                  key={l.sym}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => {
                    setSelectedSym(l.sym);
                    setSharesStr("");
                  }}
                  className="rounded-[2px] transition-colors"
                  style={{
                    padding: "6px 10px",
                    fontSize: 11,
                    fontFamily: "JetBrains Mono",
                    background: isSelected ? "var(--ink)" : "transparent",
                    color: isSelected ? "var(--paper)" : "var(--ink-soft)",
                    border: `1px solid ${isSelected ? "var(--ink)" : "var(--hairline)"}`,
                  }}
                >
                  {l.sym}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "18px 24px 12px" }}>
        <div
          className="flex justify-between items-baseline"
          style={{ marginBottom: 8 }}
        >
          <label htmlFor={sharesId} className="eyebrow">
            Shares to withdraw
          </label>
          <span
            id={helperId}
            className="font-mono text-ink-mute tabular"
            style={{ fontSize: 10 }}
          >
            balance{" "}
            {fmt.num(line?.shares ?? 0, (line?.shares ?? 0) < 1 ? 4 : 0)}{" "}
            {selectedSym}
          </span>
        </div>
        <div
          className="flex items-center gap-2 bg-paper rounded-[2px]"
          style={{
            padding: "12px 14px",
            border: `1.4px solid ${invalid ? "var(--down)" : "var(--ink)"}`,
          }}
        >
          <input
            id={sharesId}
            type="number"
            step="any"
            min="0"
            value={sharesStr}
            onChange={(e) => setSharesStr(e.target.value)}
            disabled={!isConnected || mining || isPending}
            placeholder="0"
            aria-describedby={`${helperId} ${errorId}`}
            aria-invalid={hasInputError || undefined}
            className="font-serif font-medium tabular bg-transparent border-0 outline-none flex-1 w-full min-w-0"
            style={{ fontSize: 22, letterSpacing: "-0.02em" }}
          />
          <span className="font-mono text-ink-soft" style={{ fontSize: 13 }}>
            {selectedSym}
          </span>
        </div>
        <div className="flex justify-between mt-2">
          <span
            className="font-mono text-ink-mute tabular"
            style={{ fontSize: 10 }}
          >
            ≈ {fmt.usd(withdrawUsd, 2)} · live {fmt.usd(livePrice, 2)}
          </span>
          <div className="flex gap-1.5">
            {[0.25, 0.5, 0.75, 1].map((frac) => (
              <button
                key={frac}
                type="button"
                onClick={() => {
                  const s = maxShares * frac;
                  setSharesStr(s > 0 ? s.toFixed(4) : "");
                }}
                disabled={!isConnected || maxShares <= 0}
                className="bg-transparent border border-hairline rounded-[2px] hover:border-ink transition-colors"
                style={{ padding: "3px 8px", fontSize: 10 }}
              >
                {frac === 1 ? "MAX" : `${frac * 100}%`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div
        className="border-t border-hairline-soft"
        style={{ padding: "12px 24px 14px" }}
      >
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          After withdrawal
        </div>
        <PreviewRow
          k="Remaining collateral"
          v={fmt.usd(newCollateralUsd, 2)}
        />
        <PreviewRow
          k="LTV"
          v={
            newCollateralUsd > 0
              ? `${newLtv.toFixed(1)}% / ${ltvCap.toFixed(0)}% cap`
              : "—"
          }
          color={
            overCap
              ? "var(--down)"
              : newLtv / ltvCap > 0.85
                ? "var(--amber)"
                : "var(--ink)"
          }
        />
        <div style={{ marginTop: 10 }}>
          <HealthFactorMeter before={currentHf} after={newHf} />
        </div>
      </div>
    </ModalShell>
  );
}
