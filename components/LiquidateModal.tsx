"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { encodeFunctionData, parseUnits, type Address, type Hex } from "viem";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  ERC20_ABI,
  EQUIFLOW_VAULT_ABI,
  shortAddr,
} from "@/lib/contracts";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { fmt } from "@/lib/format";
import { findStock } from "@/lib/config/stocks";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import { sendUserOp } from "@/lib/aa/send-userop";
import { AA_CONFIGURED } from "@/lib/web3/alchemy";
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
  SealedMessage,
  TxError,
  TxLink,
  ValidationError,
} from "./modal";

/// Liquidate an at-risk position. Two-step wagmi flow:
///   1. Approve USDG transfer to the vault (if allowance is short)
///   2. vault.liquidate(user, token, debtUsdToRepay)
///
/// Liquidator pays USDG, receives collateral_seized = (debtRepaid / price)
/// × (1 + liquidationBonus). Default bonus in EquiFlow is 5 %.

type Stage =
  | "idle"
  | "approving"
  | "approve-mining"
  | "liquidating"
  | "liquidate-mining"
  | "sealed";

const FALLBACK_BONUS_BPS = 500;
const ONE_E18 = 10n ** 18n;

interface Props {
  open: boolean;
  onClose: () => void;
  /// Target position to liquidate.
  user: Address;
  /// Total debt of the position (1e18 USD units). Caps the repay input.
  borrowedUsd: bigint;
  /// Total collateral (1e18 USD units). Display only.
  collateralUsd: bigint;
  /// Health factor (1e18). Display only — caller already filtered HF < 1.
  healthFactor: bigint;
  /// Collateral tokens listed on the vault (vault.listedAssets()).
  /// We let the liquidator pick which one to seize.
  listedAssets: readonly Address[];
}

export function LiquidateModal({
  open,
  onClose,
  user,
  borrowedUsd,
  collateralUsd,
  healthFactor,
  listedAssets,
}: Props) {
  const { vault } = useVaultContext();
  const VAULT_ADDR = vault.address;
  const TOKEN_ADDR = vault.tokenAddress;
  const tokenSymbol = vault.borrowSymbol;
  const queryClient = useQueryClient();

  const debtId = useId();
  const debtHelperId = useId();
  const debtErrorId = useId();

  const { data: bonusBpsRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: VAULT_ADDR,
    functionName: "LIQUIDATION_BONUS_BPS",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!VAULT_ADDR, staleTime: Infinity },
  });
  const LIQUIDATION_BONUS_BPS = bonusBpsRaw != null
    ? Number(bonusBpsRaw as bigint)
    : FALLBACK_BONUS_BPS;

  const { address: liquidatorEoa, isConnected } = useAccount();
  const { mode: aaMode, smartAccount, smartAddress, prepareForSubmit } =
    useSmartWallet();
  const aaActive = aaMode !== "off" && smartAccount != null;
  const liquidator = (aaActive && smartAddress ? smartAddress : liquidatorEoa) as
    | Address
    | undefined;

  const [debtStr, setDebtStr] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [tokenIdx, setTokenIdx] = useState(0);
  const [aaError, setAaError] = useState<string | null>(null);
  const [aaTxHash, setAaTxHash] = useState<Hex | null>(null);
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);
  const [toastId, setToastId] = useState<string | number | null>(null);

  const collateralContracts = useMemo(
    () =>
      listedAssets.map((token) => ({
        abi: EQUIFLOW_VAULT_ABI,
        address: VAULT_ADDR,
        functionName: "collateral" as const,
        args: [user, token] as const,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      })),
    [listedAssets, user, VAULT_ADDR],
  );
  const { data: collateralRows } = useReadContracts({
    allowFailure: true,
    contracts: collateralContracts,
    query: { enabled: open && listedAssets.length > 0 },
  });

  const symbolContracts = useMemo(
    () =>
      listedAssets.map((token) => ({
        abi: ERC20_ABI,
        address: token,
        functionName: "symbol" as const,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      })),
    [listedAssets],
  );
  const { data: symbolRows } = useReadContracts({
    allowFailure: true,
    contracts: symbolContracts,
    query: { enabled: open && listedAssets.length > 0 },
  });

  const seizableTokens = useMemo(() => {
    const out: Array<{ address: Address; symbol: string; collateralRaw: bigint }> = [];
    listedAssets.forEach((addr, i) => {
      const c = collateralRows?.[i];
      if (c?.status !== "success") return;
      const raw = c.result as bigint;
      if (raw === 0n) return;
      const symbolR = symbolRows?.[i];
      const symbol =
        symbolR?.status === "success"
          ? (symbolR.result as string)
          : findStock(addr).sym;
      out.push({ address: addr, symbol, collateralRaw: raw });
    });
    return out;
  }, [listedAssets, collateralRows, symbolRows]);

  useEffect(() => {
    if (tokenIdx >= seizableTokens.length) setTokenIdx(0);
  }, [seizableTokens.length, tokenIdx]);

  const selected = seizableTokens[tokenIdx] ?? null;

  /// Display values (USD).
  const borrowedUsdNum = Number(borrowedUsd / 10n ** 12n) / 1e6;
  const collateralUsdNum = Number(collateralUsd / 10n ** 12n) / 1e6;
  const hfNum = healthFactor < ONE_E18 * 1000n
    ? Number(healthFactor) / 1e18
    : Number.POSITIVE_INFINITY;
  const debtRepayUsd = Math.max(0, Number(debtStr) || 0);
  const bonusPct = LIQUIDATION_BONUS_BPS / 100;
  const collateralValueSeizedUsd = debtRepayUsd * (1 + bonusPct / 100);
  const bonusGainedUsd = collateralValueSeizedUsd - debtRepayUsd;
  const overDebt = debtRepayUsd > borrowedUsdNum + 0.001;
  // Projected HF after the repay leg lands — surface in the meter so the
  // liquidator sees what they're moving the position to (often ∞ if they
  // clear all debt).
  const newDebtUsd = Math.max(0, borrowedUsdNum - debtRepayUsd);
  const newHf =
    newDebtUsd > 0 && collateralUsdNum > 0
      ? (hfNum * borrowedUsdNum) / newDebtUsd
      : Number.POSITIVE_INFINITY;

  const { data: stableDecimalsRaw } = useReadContract({
    abi: ERC20_ABI,
    address: TOKEN_ADDR,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: open && !!TOKEN_ADDR },
  });
  const stableDec =
    typeof stableDecimalsRaw === "number" ? stableDecimalsRaw : 6;

  const { data: usdgBalance } = useReadContract({
    abi: ERC20_ABI,
    address: TOKEN_ADDR,
    functionName: "balanceOf",
    args: liquidator ? [liquidator] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: open && !!TOKEN_ADDR && !!liquidator },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: ERC20_ABI,
    address: TOKEN_ADDR,
    functionName: "allowance",
    args:
      liquidator && VAULT_ADDR
        ? [liquidator, VAULT_ADDR]
        : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: open && !!TOKEN_ADDR && !!liquidator },
  });

  const debtRepayE18 = parseUnits(debtRepayUsd.toFixed(6), 18);
  const requiredUsdg = parseUnits(debtRepayUsd.toFixed(6), stableDec);
  const balanceShort =
    usdgBalance != null && requiredUsdg > (usdgBalance as bigint);
  const needsApprove =
    allowance == null || (allowance as bigint) < requiredUsdg;

  const {
    data: approveHash,
    writeContract: writeApprove,
    isPending: approvePending,
  } = useWriteContract();
  const { isSuccess: approveSealed } = useWaitForTransactionReceipt({
    hash: approveHash,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
  });

  const {
    data: liquidateHash,
    writeContract: writeLiquidate,
    isPending: liqPending,
    error: liquidateError,
  } = useWriteContract();
  const { isSuccess: liqSealed } = useWaitForTransactionReceipt({
    hash: liquidateHash,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
  });

  useEffect(() => {
    if (approveSealed && stage === "approve-mining") {
      refetchAllowance();
      setStage("idle");
    }
  }, [approveSealed, stage, refetchAllowance]);
  useEffect(() => {
    if (liqSealed && stage === "liquidate-mining") setStage("sealed");
  }, [liqSealed, stage]);

  useEffect(() => {
    if (!open) {
      setDebtStr("");
      setStage("idle");
      setTokenIdx(0);
      setAaError(null);
      setAaTxHash(null);
      setAcknowledgeRisk(false);
      setToastId(null);
    }
  }, [open]);

  useEffect(() => {
    if (stage !== "sealed") return;
    if (toastId !== null) {
      txSealedToast(toastId, {
        action: `Liquidate ${fmt.usd(debtRepayUsd, 0)}`,
        txHash: aaTxHash ?? liquidateHash,
      });
    }
    queryClient.invalidateQueries({
      predicate: (q) => qkMatches.postTx(q.queryKey),
    });
    queryClient.invalidateQueries({ queryKey: ["wagmi"] });
    const t = setTimeout(() => onClose(), 2000);
    return () => clearTimeout(t);
  }, [
    stage,
    onClose,
    toastId,
    debtRepayUsd,
    aaTxHash,
    liquidateHash,
    queryClient,
  ]);

  useEffect(() => {
    if (!liquidateError) return;
    if (toastId !== null) txErrorToast(toastId, liquidateError);
  }, [liquidateError, toastId]);

  // Liquidations are irreversible; require explicit ack so a stray click on a
  // dust position doesn't also sweep up the rest of the user's collateral.
  const requiresAck = debtRepayUsd > 0;
  const showAckGate = requiresAck && !acknowledgeRisk;

  function onApprove() {
    if (!TOKEN_ADDR || !VAULT_ADDR) return;
    setStage("approving");
    writeApprove(
      {
        abi: ERC20_ABI,
        address: TOKEN_ADDR,
        functionName: "approve",
        args: [VAULT_ADDR, requiredUsdg],
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        onSuccess: () => setStage("approve-mining"),
        onError: () => setStage("idle"),
      },
    );
  }

  function onLiquidate() {
    if (!VAULT_ADDR || !selected) return;
    const id = txPendingToast({
      action: `Liquidate ${fmt.usd(debtRepayUsd, 0)} · seize ${selected.symbol}`,
    });
    setToastId(id);
    setStage("liquidating");
    writeLiquidate(
      {
        abi: EQUIFLOW_VAULT_ABI,
        address: VAULT_ADDR,
        functionName: "liquidate",
        args: [user, selected.address, debtRepayE18],
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        onSuccess: () => setStage("liquidate-mining"),
        onError: (err) => {
          txErrorToast(id, err);
          setStage("idle");
        },
      },
    );
  }

  async function onBundle() {
    if (!TOKEN_ADDR || !VAULT_ADDR || !selected || !smartAccount) {
      return;
    }
    setAaError(null);
    const id = txPendingToast({
      action: `Liquidate ${fmt.usd(debtRepayUsd, 0)} · seize ${selected.symbol} (sponsored)`,
    });
    setToastId(id);
    setStage("liquidating");
    try {
      await prepareForSubmit();

      const calls = [];
      if (needsApprove) {
        calls.push({
          to: TOKEN_ADDR as Address,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [VAULT_ADDR, requiredUsdg],
          }),
        });
      }
      calls.push({
        to: VAULT_ADDR as Address,
        data: encodeFunctionData({
          abi: EQUIFLOW_VAULT_ABI,
          functionName: "liquidate",
          args: [user, selected.address, debtRepayE18],
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
    } catch (err) {
      console.error("[LiquidateModal] UserOp failed:", err);
      const msg = friendlyError(err);
      setAaError(msg);
      txErrorToast(id, err);
      setStage("idle");
    }
  }

  const busy =
    stage === "approving" ||
    stage === "approve-mining" ||
    stage === "liquidating" ||
    stage === "liquidate-mining" ||
    approvePending ||
    liqPending;
  const sealed = stage === "sealed";

  let ctaLabel: string;
  let ctaAction: (() => void) | null = null;
  let ctaDisabled = true;

  if (!isConnected) {
    ctaLabel = "Connect wallet";
  } else if (seizableTokens.length === 0) {
    ctaLabel = "Nothing to seize";
  } else if (aaActive && AA_CONFIGURED) {
    if (stage === "liquidating") ctaLabel = "Bundling UserOp…";
    else ctaLabel = `Sign once · liquidate ${selected?.symbol ?? ""}`;
    ctaAction = onBundle;
    ctaDisabled =
      busy || debtRepayUsd <= 0 || overDebt || balanceShort || !selected || showAckGate;
  } else if (needsApprove) {
    if (stage === "approving" || approvePending) ctaLabel = "Awaiting wallet…";
    else if (stage === "approve-mining") ctaLabel = "Approval mining…";
    else ctaLabel = `Approve ${tokenSymbol}`;
    ctaAction = onApprove;
    ctaDisabled = busy || debtRepayUsd <= 0 || overDebt || balanceShort;
  } else {
    if (stage === "liquidating" || liqPending) ctaLabel = "Awaiting wallet…";
    else if (stage === "liquidate-mining") ctaLabel = "Liquidating…";
    else ctaLabel = `Liquidate ${selected?.symbol ?? ""}`;
    ctaAction = onLiquidate;
    ctaDisabled =
      busy || debtRepayUsd <= 0 || overDebt || balanceShort || !selected || showAckGate;
  }

  const hasInputError = overDebt || balanceShort;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      variant="centered"
      width={560}
      eyebrow={
        <span style={{ color: "var(--down)" }}>
          At-risk position · liquidate
        </span>
      }
      title={shortAddr(user)}
      footer={
        <>
          {overDebt && (
            <ValidationError id={debtErrorId}>
              Cannot repay more than the outstanding debt.
            </ValidationError>
          )}
          {balanceShort && !overDebt && (
            <ValidationError>
              Your {tokenSymbol} balance is short of the repay amount.
            </ValidationError>
          )}
          <TxError message={aaError ?? friendlyError(liquidateError)} />
          <TxLink hash={aaTxHash ?? liquidateHash} />
          {sealed && (
            <SealedMessage>
              Liquidated {fmt.usd(debtRepayUsd, 0)} · seized{" "}
              {fmt.usd(collateralValueSeizedUsd, 0)} of {selected?.symbol}.
            </SealedMessage>
          )}
          {requiresAck && !sealed && (
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
                I understand the seizure is irreversible and the collateral
                cannot be returned to the borrower.
              </span>
            </label>
          )}
          <ModalActions
            onClose={onClose}
            sealed={sealed}
            cta={
              ctaAction
                ? {
                    label: ctaLabel,
                    onClick: ctaAction,
                    disabled: ctaDisabled,
                    busy,
                  }
                : undefined
            }
          />
          <ContractTrustLine address={VAULT_ADDR} />
          <ModalFootnote>
            Calls{" "}
            <span className="font-mono">
              vault.liquidate({shortAddr(user)}, {selected?.symbol ?? "—"},{" "}
              {fmt.usd(debtRepayUsd, 0)})
            </span>{" "}
            · seize bonus +{bonusPct.toFixed(0)}%
          </ModalFootnote>
        </>
      }
    >
      {/* Snapshot */}
      <div className="grid grid-cols-3 border-b border-hairline-soft">
        <SnapshotCell label="Debt" value={fmt.usd(borrowedUsdNum, 0)} />
        <SnapshotCell label="Collateral" value={fmt.usd(collateralUsdNum, 0)} />
        <SnapshotCell
          label="Health"
          value={hfNum === Number.POSITIVE_INFINITY ? "∞" : hfNum.toFixed(3)}
          color={hfNum < 1 ? "var(--down)" : undefined}
          last
        />
      </div>

      <div style={{ padding: "20px 24px 12px" }}>
        {!isConnected ? (
          <div
            className="border border-hairline rounded-[2px] p-4 text-center text-ink-mute"
            style={{ fontSize: 13 }}
          >
            Connect a wallet to liquidate. Your account pays the {tokenSymbol},
            the vault hands you the seized collateral plus a{" "}
            {bonusPct.toFixed(0)}% bonus.
          </div>
        ) : seizableTokens.length === 0 ? (
          <div
            className="border border-hairline rounded-[2px] p-4 text-center text-ink-mute"
            style={{ fontSize: 13 }}
          >
            This position has debt but no on-chain collateral entries — cannot
            liquidate (already drained or read failed).
          </div>
        ) : (
          <>
            {/* Seize-token selector */}
            <div className="eyebrow mb-2">Seize collateral</div>
            <div
              className="grid gap-1 mb-4"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}
              role="radiogroup"
              aria-label="Seize collateral token"
            >
              {seizableTokens.map((t, i) => {
                const isSelected = i === tokenIdx;
                return (
                  <button
                    key={t.address}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setTokenIdx(i)}
                    className="border rounded-[2px] py-2 cursor-pointer font-mono"
                    style={{
                      fontSize: 12,
                      borderColor: isSelected ? "var(--ink)" : "var(--hairline)",
                      background: isSelected ? "var(--ink)" : "transparent",
                      color: isSelected ? "var(--paper)" : "var(--ink)",
                    }}
                  >
                    {t.symbol}
                  </button>
                );
              })}
            </div>

            {/* Debt-to-repay input */}
            <label htmlFor={debtId} className="eyebrow mb-2 block">
              Debt to repay ({tokenSymbol})
            </label>
            <div
              className="flex items-center gap-2 mb-2"
              style={{
                border: `1px solid ${hasInputError ? "var(--down)" : "var(--ink)"}`,
                padding: "10px 12px",
                borderRadius: 2,
              }}
            >
              <input
                id={debtId}
                type="number"
                value={debtStr}
                onChange={(e) => setDebtStr(e.target.value)}
                placeholder="0.00"
                aria-describedby={`${debtHelperId} ${debtErrorId}`}
                aria-invalid={hasInputError || undefined}
                className="font-serif font-medium tabular bg-transparent border-0 outline-none flex-1 w-full min-w-0"
                style={{ fontSize: 20, letterSpacing: "-0.02em" }}
              />
              <button
                type="button"
                onClick={() => setDebtStr(borrowedUsdNum.toFixed(2))}
                className="bg-transparent border border-hairline-soft rounded-[2px] px-2 py-0.5 cursor-pointer text-ink-soft hover:text-ink"
                style={{ fontSize: 11 }}
              >
                Max
              </button>
            </div>
            <div
              id={debtHelperId}
              className="text-ink-mute mb-4"
              style={{ fontSize: 11 }}
            >
              Up to {fmt.usd(borrowedUsdNum, 2)} · Your {tokenSymbol} balance{" "}
              {usdgBalance != null
                ? fmt.usd(
                    Number(usdgBalance as bigint) / Math.pow(10, stableDec),
                    2,
                  )
                : "—"}
            </div>

            {/* Seized preview */}
            <div className="bg-paper-alt rounded-[2px] p-4 mb-4">
              <PreviewLine k="You pay" v={fmt.usd(debtRepayUsd, 2)} />
              <PreviewLine
                k={`Collateral seized (incl. ${bonusPct.toFixed(0)}% bonus)`}
                v={fmt.usd(collateralValueSeizedUsd, 2)}
              />
              <PreviewLine
                k="Your profit"
                v={`+${fmt.usd(bonusGainedUsd, 2)}`}
                tone="up"
              />
              <div style={{ marginTop: 10 }}>
                <HealthFactorMeter
                  before={hfNum}
                  after={newHf}
                  label="Target health factor"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

function SnapshotCell({
  label,
  value,
  color,
  last,
}: {
  label: string;
  value: string;
  color?: string;
  last?: boolean;
}) {
  return (
    <div
      className="px-4 py-3"
      style={{ borderRight: last ? "none" : "1px solid var(--hairline-soft)" }}
    >
      <div className="eyebrow mb-1">{label}</div>
      <div
        className="font-serif font-medium tabular"
        style={{
          fontSize: 18,
          letterSpacing: "-0.01em",
          color: color ?? "var(--ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function PreviewLine({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "up";
}) {
  return (
    <div className="flex justify-between py-1" style={{ fontSize: 12 }}>
      <span className="text-ink-soft">{k}</span>
      <span
        className={`font-mono tabular font-medium ${tone === "up" ? "text-up" : ""}`}
      >
        {v}
      </span>
    </div>
  );
}
