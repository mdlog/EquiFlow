"use client";

import { useEffect, useId, useState } from "react";
import { type Address, type Hex, encodeFunctionData } from "viem";
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  ERC20_ABI,
  EQUIFLOW_VAULT_ABI,
} from "@/lib/contracts";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { fmt } from "@/lib/format";
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
import {
  ContractTrustLine,
  ModalActions,
  ModalShell,
  PreviewRow,
  SealedMessage,
  SumRow,
  TxError,
  TxLink,
  ValidationError,
} from "./modal";

/// LP withdraw modal. Burns LP shares → receives USDG out.
/// Reverts on-chain if vault doesn't have enough idle USDG (too much lent out
/// → utilization == 100%).

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LpWithdrawModal({ open, onClose }: Props) {
  const { vault } = useVaultContext();
  const VAULT_ADDR = vault.address;
  const TOKEN_ADDR = vault.tokenAddress;
  const tokenSymbol = vault.borrowSymbol;
  const { address, isConnected } = useActiveWallet();
  const { mode: aaMode, smartAccount, prepareForSubmit } = useSmartWallet();
  const aaActive = aaMode !== "off" && smartAccount != null;
  const queryClient = useQueryClient();

  const sharesId = useId();
  const helperId = useId();
  const errorId = useId();

  const [sharesStr, setSharesStr] = useState("");
  const [toastId, setToastId] = useState<string | number | null>(null);

  const { data: stableDecimalsRaw } = useReadContract({
    abi: ERC20_ABI,
    address: TOKEN_ADDR,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!TOKEN_ADDR },
  });
  const stableDec =
    typeof stableDecimalsRaw === "number" ? stableDecimalsRaw : 6;

  const { data: lpPos } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: VAULT_ADDR,
    functionName: "lpPositionOf",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: {
      enabled: !!VAULT_ADDR && !!address,
      refetchInterval: 12_000,
    },
  });

  const [sharesOwnedRaw, usdValueRaw, usdgValueRaw] = (lpPos as
    | readonly [bigint, bigint, bigint]
    | undefined) ?? [0n, 0n, 0n];
  const sharesOwned = Number(sharesOwnedRaw) / 1e18;
  const usdValueTotal = Number(usdValueRaw) / 1e18;
  const usdgValueTotal = Number(usdgValueRaw) / 10 ** stableDec;

  // Adaptive precision for shares display. After a "dust first depositor"
  // event (a microscopic first deposit baseline-sets the share price to
  // ≈ $1e6 per displayed share), legitimate $X deposits get raw share
  // counts in the 1e13 range which the previous `toFixed(4)` rendered as
  // "0.0000" — even though the $ value column was correct. This formatter
  // shows enough decimals (or switches to scientific notation) so the
  // share count is never displayed as zero when the user actually owns
  // some shares.
  function fmtShares(v: number): string {
    if (v === 0) return "0";
    if (v >= 1) return v.toFixed(2);
    if (v >= 0.0001) return v.toFixed(4);
    // Sub-0.0001 — use up to 8 decimals; switch to e-notation below 1e-8.
    if (v >= 1e-8) return v.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    return v.toExponential(2);
  }

  const { data: bookedRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: VAULT_ADDR,
    functionName: "bookedUsdg",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!VAULT_ADDR, refetchInterval: 12_000 },
  });
  const vaultIdle =
    bookedRaw !== undefined
      ? Number(bookedRaw as bigint) / 10 ** stableDec
      : 0;

  const shares = Math.max(0, Number(sharesStr) || 0);
  const overShares = shares > sharesOwned + 1e-9;
  const sharePct = sharesOwned > 0 ? shares / sharesOwned : 0;
  const usdgOut = usdgValueTotal * sharePct;
  const insufficientIdle = usdgOut > vaultIdle + 0.001;

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
  const busy = isPending || mining || aaBusy;

  useEffect(() => {
    if (!open) {
      setSharesStr("");
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
        action: `Withdraw ${fmt.usd(usdgOut, 2)} ${tokenSymbol}`,
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
    usdgOut,
    tokenSymbol,
    aaTxHash,
    txHash,
    queryClient,
  ]);

  useEffect(() => {
    if (!error) return;
    if (toastId !== null) txErrorToast(toastId, error);
  }, [error, toastId]);

  function handleWithdraw() {
    if (!VAULT_ADDR) return;
    const raw =
      sharesStr.trim().length > 0
        ? parseAmount(sharesStr, 18)
        : 0n;
    if (raw <= 0n) return;
    const id = txPendingToast({
      action: `Burn ${fmtShares(shares)} LP shares${aaActive ? " (sponsored)" : ""}`,
    });
    setToastId(id);
    if (aaActive && smartAccount && AA_CONFIGURED) {
      void handleBundle(raw, id);
      return;
    }
    writeContract({
      abi: EQUIFLOW_VAULT_ABI,
      address: VAULT_ADDR,
      functionName: "withdrawLp",
      args: [raw],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  }

  async function handleBundle(raw: bigint, id: string | number) {
    if (!VAULT_ADDR || !smartAccount) return;
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
              functionName: "withdrawLp",
              args: [raw],
            }),
          },
        ],
        gasMode: "sponsored",
      });
      setAaTxHash(hash);
    } catch (err) {
      console.error("[LpWithdrawModal] UserOp failed:", err);
      setAaError(friendlyError(err));
      txErrorToast(id, err);
    } finally {
      setAaBusy(false);
    }
  }

  const canWithdraw =
    isConnected &&
    !!VAULT_ADDR &&
    shares > 0 &&
    !overShares &&
    !insufficientIdle &&
    !busy &&
    !sealed;

  let ctaLabel: string;
  if (!isConnected) ctaLabel = "Connect wallet";
  else if (aaBusy) ctaLabel = "Bundling sponsored UserOp…";
  else if (isPending) ctaLabel = "Sign in wallet…";
  else if (mining) ctaLabel = "Withdrawing…";
  else if (aaActive) ctaLabel = `Burn ${shares > 0 ? fmtShares(shares) : "0"} shares (sponsored)`;
  else ctaLabel = `Burn ${shares > 0 ? fmtShares(shares) : "0"} shares`;

  const hasInputError = overShares || insufficientIdle;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      eyebrow={`withdrawLp(shares) · burn for ${tokenSymbol}`}
      title="Withdraw LP"
      footer={
        <>
          {overShares && (
            <ValidationError id={errorId}>Exceeds your share balance.</ValidationError>
          )}
          {insufficientIdle && shares > 0 && (
            <ValidationError>
              Vault doesn&apos;t have enough idle {tokenSymbol} ({fmt.usd(vaultIdle, 2)}{" "}
              available, you&apos;d need {fmt.usd(usdgOut, 2)}). Borrowers must
              repay first.
            </ValidationError>
          )}
          <TxError message={aaError ?? friendlyError(error)} />
          <TxLink hash={aaTxHash ?? txHash} />
          {sealed && (
            <SealedMessage>
              Withdrew {fmt.usd(usdgOut, 2)} {tokenSymbol} · check your wallet
            </SealedMessage>
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
        </>
      }
    >
      <div
        className="border-b border-hairline-soft bg-paper-alt"
        style={{ padding: "14px 24px" }}
      >
        <SumRow
          k="Your LP shares"
          v={fmtShares(sharesOwned)}
        />
        <SumRow
          k="Position value"
          v={fmt.usd(usdValueTotal, 2)}
          color="var(--up)"
        />
        <SumRow
          k={`Vault idle ${tokenSymbol}`}
          v={fmt.usd(vaultIdle, 2)}
          color={insufficientIdle ? "var(--down)" : "var(--ink)"}
        />
      </div>

      <div style={{ padding: "18px 24px 12px" }}>
        <div
          className="flex justify-between items-baseline"
          style={{ marginBottom: 8 }}
        >
          <label htmlFor={sharesId} className="eyebrow">
            Shares to burn
          </label>
          <span
            id={helperId}
            className="font-mono text-ink-mute tabular"
            style={{ fontSize: 10 }}
          >
            owned {fmtShares(sharesOwned)}
          </span>
        </div>
        <div
          className="flex items-center gap-2 bg-paper rounded-[2px]"
          style={{
            padding: "12px 14px",
            border: `1.4px solid ${overShares || insufficientIdle ? "var(--down)" : "var(--ink)"}`,
          }}
        >
          <input
            id={sharesId}
            type="number"
            step="any"
            min="0"
            max={sharesOwned}
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
            shares
          </span>
        </div>
        <div className="flex gap-1.5 mt-2.5">
          {[0.25, 0.5, 0.75, 1].map((frac) => (
            <button
              key={frac}
              type="button"
              // 10 decimals so micro-shares survive the percentage buttons
              // after a dust first-depositor event skews the share price.
              onClick={() => setSharesStr((sharesOwned * frac).toFixed(10))}
              disabled={!isConnected || sharesOwned <= 0}
              className="bg-transparent border border-hairline rounded-[2px] hover:border-ink transition-colors"
              style={{ padding: "4px 9px", fontSize: 10 }}
            >
              {frac === 1 ? "MAX" : `${frac * 100}%`}
            </button>
          ))}
        </div>
      </div>

      <div
        className="border-t border-hairline-soft"
        style={{ padding: "12px 24px 14px" }}
      >
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          You receive
        </div>
        <PreviewRow
          k={`${tokenSymbol} to wallet`}
          v={fmt.usd(usdgOut, 2)}
          color="var(--up)"
        />
        <PreviewRow
          k="Remaining shares"
          v={fmtShares(sharesOwned - shares)}
        />
      </div>
    </ModalShell>
  );
}
