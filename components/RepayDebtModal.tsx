"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData, maxUint256, parseUnits, type Address, type Hex } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  ERC20_ABI,
  EQUIFLOW_VAULT_ABI,
} from "@/lib/contracts";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { fmt } from "@/lib/format";
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

/// Repay debt modal: supports partial repay via repay(amountUsd) or full via
/// repayMax(). Two-step flow with USDG approval when allowance is insufficient.
///
/// State machine:
///   idle → approving → mining → repaying → mining → sealed
///
/// repay() pulls `_usdToUsdc(amountUsd)` USDG via transferFrom — user must
/// approve at least that amount first.

type Stage =
  | "idle"
  | "approving"
  | "approve-mining"
  | "repaying"
  | "repay-mining"
  | "sealed";

interface Props {
  open: boolean;
  onClose: () => void;
  borrowedUsd: number;
  collateralUsd: number;
  ltvCap: number;
  liqLtv: number;
}

export function RepayDebtModal({
  open,
  onClose,
  borrowedUsd,
  collateralUsd,
  ltvCap,
  liqLtv,
}: Props) {
  const { vault } = useVaultContext();
  const VAULT_ADDR = vault.address;
  const TOKEN_ADDR = vault.tokenAddress;
  const tokenSymbol = vault.borrowSymbol;

  const { address: eoaAddress, isConnected } = useAccount();
  const { mode: aaMode, smartAccount, smartAddress, prepareForSubmit } =
    useSmartWallet();
  const aaActive = aaMode !== "off" && smartAccount != null;
  const address = (aaActive && smartAddress ? smartAddress : eoaAddress) as
    | Address
    | undefined;

  const [amountStr, setAmountStr] = useState("");
  const [useMax, setUseMax] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [aaError, setAaError] = useState<string | null>(null);
  const [aaTxHash, setAaTxHash] = useState<Hex | null>(null);

  const amount = useMax ? borrowedUsd : Math.max(0, Number(amountStr) || 0);
  const overDebt = amount > borrowedUsd + 0.001;
  const newDebt = Math.max(0, borrowedUsd - amount);
  const newLtv = collateralUsd > 0 ? (newDebt / collateralUsd) * 100 : 0;
  const newHf = newLtv > 0 ? liqLtv / newLtv : Number.POSITIVE_INFINITY;

  const { data: stableDecimalsRaw } = useReadContract({
    abi: ERC20_ABI,
    address: TOKEN_ADDR,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!TOKEN_ADDR },
  });
  const stableDec =
    typeof stableDecimalsRaw === "number" ? stableDecimalsRaw : 6;

  const { data: balance } = useReadContract({
    abi: ERC20_ABI,
    address: TOKEN_ADDR,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!TOKEN_ADDR && !!address, refetchInterval: 12_000 },
  });
  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    abi: ERC20_ABI,
    address: TOKEN_ADDR,
    functionName: "allowance",
    args:
      address && VAULT_ADDR
        ? [address, VAULT_ADDR]
        : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: {
      enabled: !!TOKEN_ADDR && !!address && !!VAULT_ADDR,
    },
  });

  const usdgExact =
    amount > 0 ? parseUnits(amount.toFixed(stableDec), stableDec) : 0n;
  const amountUsd18 =
    stableDec < 18
      ? usdgExact * 10n ** BigInt(18 - stableDec)
      : usdgExact / 10n ** BigInt(stableDec - 18);
  const usdgNeeded = usdgExact + (amount > 0 ? 1n : 0n);
  const allowance = (allowanceRaw as bigint | undefined) ?? 0n;
  const userBalance = (balance as bigint | undefined) ?? 0n;
  const insufficient = usdgNeeded > userBalance;

  const { writeContract, data: txHash, isPending, error, reset } =
    useWriteContract();
  const { isLoading: mining, isSuccess: receiptSuccess } =
    useWaitForTransactionReceipt({
      hash: txHash,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });

  useEffect(() => {
    if (!receiptSuccess) return;
    if (stage === "approve-mining") {
      setStage("repaying");
      refetchAllowance();
      if (VAULT_ADDR) {
        if (useMax) {
          writeContract({
            abi: EQUIFLOW_VAULT_ABI,
            address: VAULT_ADDR,
            functionName: "repayMax",
            args: [],
            chainId: ROBINHOOD_CHAIN_TESTNET_ID,
          });
        } else {
          writeContract({
            abi: EQUIFLOW_VAULT_ABI,
            address: VAULT_ADDR,
            functionName: "repay",
            args: [amountUsd18],
            chainId: ROBINHOOD_CHAIN_TESTNET_ID,
          });
        }
      }
    } else if (stage === "repay-mining") {
      setStage("sealed");
    }
  }, [receiptSuccess, stage, useMax, amount, writeContract, refetchAllowance]);

  useEffect(() => {
    if (mining && stage === "approving") setStage("approve-mining");
    if (mining && stage === "repaying") setStage("repay-mining");
  }, [mining, stage]);

  useEffect(() => {
    if (!open) {
      setAmountStr("");
      setUseMax(false);
      setStage("idle");
      reset();
    }
  }, [open, reset]);

  function handleClick() {
    if (!VAULT_ADDR || !TOKEN_ADDR) return;
    if (aaActive && smartAccount && AA_CONFIGURED) {
      void handleBundle();
      return;
    }
    if (allowance < usdgNeeded) {
      setStage("approving");
      writeContract({
        abi: ERC20_ABI,
        address: TOKEN_ADDR,
        functionName: "approve",
        args: [VAULT_ADDR, maxUint256],
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      });
    } else {
      setStage("repaying");
      if (useMax) {
        writeContract({
          abi: EQUIFLOW_VAULT_ABI,
          address: VAULT_ADDR,
          functionName: "repayMax",
          args: [],
          chainId: ROBINHOOD_CHAIN_TESTNET_ID,
        });
      } else {
        writeContract({
          abi: EQUIFLOW_VAULT_ABI,
          address: VAULT_ADDR,
          functionName: "repay",
          args: [amountUsd18],
          chainId: ROBINHOOD_CHAIN_TESTNET_ID,
        });
      }
    }
  }

  async function handleBundle() {
    if (!VAULT_ADDR || !TOKEN_ADDR || !smartAccount) return;
    setAaError(null);
    setStage("repaying");
    try {
      await prepareForSubmit();
      const calls = [];
      if (allowance < usdgNeeded) {
        calls.push({
          to: TOKEN_ADDR as Address,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [VAULT_ADDR, maxUint256],
          }),
        });
      }
      calls.push(
        useMax
          ? {
              to: VAULT_ADDR as Address,
              data: encodeFunctionData({
                abi: EQUIFLOW_VAULT_ABI,
                functionName: "repayMax",
                args: [],
              }),
            }
          : {
              to: VAULT_ADDR as Address,
              data: encodeFunctionData({
                abi: EQUIFLOW_VAULT_ABI,
                functionName: "repay",
                args: [amountUsd18],
              }),
            },
      );
      const { txHash } = await sendUserOp({
        smartAccount,
        calls,
        gasMode: "sponsored",
      });
      setAaTxHash(txHash);
      setStage("sealed");
      refetchAllowance();
    } catch (err) {
      console.error("[RepayDebtModal] UserOp failed:", err);
      setAaError(err instanceof Error ? err.message : String(err));
      setStage("idle");
    }
  }

  const busy =
    isPending ||
    stage === "approve-mining" ||
    stage === "repay-mining" ||
    stage === "approving" ||
    stage === "repaying";
  const sealed = stage === "sealed";

  const canRepay =
    isConnected &&
    !!VAULT_ADDR &&
    !!TOKEN_ADDR &&
    amount > 0 &&
    !overDebt &&
    !insufficient &&
    !busy &&
    !sealed;

  let ctaLabel: string;
  if (!isConnected) ctaLabel = "Connect wallet";
  else if (!VAULT_ADDR || !TOKEN_ADDR)
    ctaLabel = "Vault not configured";
  else if (insufficient) ctaLabel = `Insufficient ${tokenSymbol} balance`;
  else if (aaActive && stage === "repaying") ctaLabel = "Bundling UserOp…";
  else if (stage === "approving" || stage === "approve-mining")
    ctaLabel =
      stage === "approve-mining" ? "Mining approval…" : "Sign approval…";
  else if (stage === "repaying" || stage === "repay-mining")
    ctaLabel = stage === "repay-mining" ? "Repaying…" : "Sign repay…";
  else if (aaActive && AA_CONFIGURED)
    ctaLabel = useMax
      ? `Sign once · bundle repayMax`
      : `Sign once · bundle repay · ${fmt.usd(amount, 2)}`;
  else if (allowance < usdgNeeded)
    ctaLabel = `Approve & repay · ${fmt.usd(amount, 2)}`;
  else
    ctaLabel = useMax
      ? `Sign repayMax · ${fmt.usd(borrowedUsd, 2)}`
      : `Sign repay · ${fmt.usd(amount, 2)}`;

  const walletUsdg = Number(userBalance) / 10 ** stableDec;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      eyebrow={`repay / repayMax · ${tokenSymbol} transferFrom`}
      title="Repay debt"
      footer={
        <>
          {overDebt && (
            <ValidationError>
              Exceeds outstanding debt. Reduce amount.
            </ValidationError>
          )}
          {insufficient && amount > 0 && (
            <ValidationError>
              Wallet {tokenSymbol} ({fmt.usd(walletUsdg, 2)}) is less than{" "}
              {fmt.usd(amount, 2)} needed. Claim from faucet or reduce amount.
            </ValidationError>
          )}
          <TxError message={error?.message} />
          {aaError && <TxError message={`UserOp: ${aaError}`} />}
          <TxLink hash={txHash} />
          <TxLink hash={aaTxHash} label="UserOp tx" />
          {sealed && (
            <SealedMessage>
              Repaid {fmt.usd(useMax ? borrowedUsd : amount, 2)} · refresh
              position to see update
            </SealedMessage>
          )}
          <ModalActions
            onClose={onClose}
            sealed={sealed}
            cta={{
              label: ctaLabel,
              onClick: handleClick,
              disabled: !canRepay,
            }}
          />
          <ModalFootnote>
            Calls{" "}
            <span className="font-mono">
              {useMax ? "repayMax()" : `repay(${fmt.usd(amount, 2)})`}
            </span>
            {allowance < usdgNeeded && amount > 0
              ? ` — auto-approves ${tokenSymbol} first`
              : ""}
          </ModalFootnote>
        </>
      }
    >
      {/* Summary */}
      <div
        className="border-b border-hairline-soft bg-paper-alt"
        style={{ padding: "14px 24px" }}
      >
        <SumRow k="Current debt" v={fmt.usd(borrowedUsd, 2)} />
        <SumRow
          k={`Wallet ${tokenSymbol} balance`}
          v={fmt.usd(walletUsdg, 2)}
          color={insufficient ? "var(--down)" : "var(--ink)"}
        />
        <SumRow
          k="Approval status"
          v={
            allowance >= usdgNeeded && amount > 0
              ? "✓ sufficient"
              : amount > 0
                ? "needs approval first"
                : "—"
          }
          color={
            allowance >= usdgNeeded && amount > 0
              ? "var(--up)"
              : "var(--ink-mute)"
          }
        />
      </div>

      {/* Input */}
      <div style={{ padding: "18px 24px 12px" }}>
        <div
          className="flex justify-between items-baseline"
          style={{ marginBottom: 8 }}
        >
          <span className="eyebrow">Amount to repay</span>
          <button
            type="button"
            onClick={() => {
              setUseMax((v) => !v);
              setAmountStr(useMax ? "" : borrowedUsd.toFixed(2));
            }}
            className="bg-transparent border border-hairline rounded-[2px] hover:border-ink transition-colors"
            style={{
              padding: "3px 8px",
              fontSize: 10,
              background: useMax ? "var(--ink)" : "transparent",
              color: useMax ? "var(--paper)" : "var(--ink-soft)",
              borderColor: useMax ? "var(--ink)" : "var(--hairline)",
            }}
          >
            MAX · {fmt.usd(borrowedUsd, 2)}
          </button>
        </div>
        <div
          className="flex items-center gap-2 bg-paper rounded-[2px]"
          style={{
            padding: "12px 14px",
            border: `1.4px solid ${overDebt ? "var(--down)" : "var(--ink)"}`,
            opacity: useMax ? 0.6 : 1,
          }}
        >
          <span className="font-mono text-ink-mute" style={{ fontSize: 14 }}>
            $
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            max={borrowedUsd}
            value={amountStr}
            onChange={(e) => {
              setAmountStr(e.target.value);
              setUseMax(false);
            }}
            disabled={!isConnected || busy || useMax}
            placeholder="0.00"
            className="font-serif font-medium tabular bg-transparent border-0 outline-none flex-1 w-full min-w-0"
            style={{ fontSize: 22, letterSpacing: "-0.02em" }}
          />
          <span className="font-mono text-ink-soft" style={{ fontSize: 13 }}>
            {tokenSymbol}
          </span>
        </div>
        <div className="flex gap-1.5 mt-2.5">
          {[0.25, 0.5, 0.75].map((frac) => (
            <button
              key={frac}
              type="button"
              onClick={() => {
                setUseMax(false);
                setAmountStr((borrowedUsd * frac).toFixed(2));
              }}
              disabled={!isConnected || borrowedUsd <= 0}
              className="bg-transparent border border-hairline rounded-[2px] hover:border-ink transition-colors"
              style={{ padding: "4px 9px", fontSize: 10 }}
            >
              {frac * 100}%
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div
        className="border-t border-hairline-soft"
        style={{ padding: "12px 24px 14px" }}
      >
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          After repay
        </div>
        <PreviewRow
          k="Debt becomes"
          v={fmt.usd(newDebt, 2)}
          color={newDebt === 0 ? "var(--up)" : "var(--ink)"}
        />
        <PreviewRow
          k="LTV"
          v={
            newDebt > 0
              ? `${newLtv.toFixed(1)}% / ${ltvCap.toFixed(0)}% cap`
              : "0%"
          }
          color="var(--ink)"
        />
        <PreviewRow
          k="Health factor"
          v={newHf === Number.POSITIVE_INFINITY ? "∞" : newHf.toFixed(2)}
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
