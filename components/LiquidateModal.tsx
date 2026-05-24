"use client";

import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, parseUnits, type Address, type Hex } from "viem";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  ERC20_ABI,
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  USDC_ADDRESS,
  explorerTx,
  shortAddr,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { fmt } from "@/lib/format";
import { findStock } from "@/lib/config/stocks";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import { sendUserOp } from "@/lib/aa/send-userop";
import { AA_CONFIGURED } from "@/lib/web3/alchemy";

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
  const { data: bonusBpsRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS,
    functionName: "LIQUIDATION_BONUS_BPS",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!EQUIFLOW_VAULT_ADDRESS, staleTime: Infinity },
  });
  const LIQUIDATION_BONUS_BPS = bonusBpsRaw != null
    ? Number(bonusBpsRaw as bigint)
    : FALLBACK_BONUS_BPS;

  const { address: liquidatorEoa, isConnected } = useAccount();
  // ── smart wallet (AA) ─────────────────────────────────────────────
  const { mode: aaMode, smartAccount, smartAddress, prepareForSubmit } =
    useSmartWallet();
  const aaActive = aaMode !== "off" && smartAccount != null;
  // The address that on-chain reads (balance, allowance) should be attributed
  // to — smart wallet when AA is active, EOA otherwise.
  const liquidator = (aaActive && smartAddress ? smartAddress : liquidatorEoa) as
    | Address
    | undefined;

  const [debtStr, setDebtStr] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [tokenIdx, setTokenIdx] = useState(0);
  const [aaError, setAaError] = useState<string | null>(null);
  const [aaTxHash, setAaTxHash] = useState<Hex | null>(null);

  /// Per-asset collateral held by the target user — picks which tokens are
  /// actually seizable. Filter the listed assets to those with non-zero
  /// collateral so the dropdown isn't full of dead entries.
  const collateralContracts = useMemo(
    () =>
      listedAssets.map((token) => ({
        abi: EQUIFLOW_VAULT_ABI,
        address: EQUIFLOW_VAULT_ADDRESS,
        functionName: "collateral" as const,
        args: [user, token] as const,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      })),
    [listedAssets, user],
  );
  const { data: collateralRows } = useReadContracts({
    allowFailure: true,
    contracts: collateralContracts,
    query: { enabled: open && listedAssets.length > 0 },
  });

  /// Per-asset symbol — read straight from the token's ERC-20 metadata so
  /// the dropdown labels survive even when the symbol isn't in our static
  /// STOCKS catalogue (e.g. owner just listed a new market).
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

  /// Reset selected token when the seizable list shrinks/changes shape.
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
  /// Liquidator can repay up to the full debt — vault clamps internally.
  const debtRepayUsd = Math.max(0, Number(debtStr) || 0);
  const bonusPct = LIQUIDATION_BONUS_BPS / 100;
  const collateralValueSeizedUsd = debtRepayUsd * (1 + bonusPct / 100);
  const bonusGainedUsd = collateralValueSeizedUsd - debtRepayUsd;
  const overDebt = debtRepayUsd > borrowedUsdNum + 0.001;

  /// USDG decimals + allowance/balance for the liquidator wallet.
  const { data: stableDecimalsRaw } = useReadContract({
    abi: ERC20_ABI,
    address: USDC_ADDRESS,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: open && !!USDC_ADDRESS },
  });
  const stableDec =
    typeof stableDecimalsRaw === "number" ? stableDecimalsRaw : 6;

  const { data: usdgBalance } = useReadContract({
    abi: ERC20_ABI,
    address: USDC_ADDRESS,
    functionName: "balanceOf",
    args: liquidator ? [liquidator] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: open && !!USDC_ADDRESS && !!liquidator },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: ERC20_ABI,
    address: USDC_ADDRESS,
    functionName: "allowance",
    args:
      liquidator && EQUIFLOW_VAULT_ADDRESS
        ? [liquidator, EQUIFLOW_VAULT_ADDRESS]
        : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: open && !!USDC_ADDRESS && !!liquidator },
  });

  /// On the wire, repay amount = debtRepayUsd in 1e18 USD units (vault converts).
  const debtRepayE18 = parseUnits(debtRepayUsd.toFixed(6), 18);
  /// Required USDG to actually pull: same number but at stable decimals.
  const requiredUsdg = parseUnits(debtRepayUsd.toFixed(6), stableDec);
  const balanceShort =
    usdgBalance != null && requiredUsdg > (usdgBalance as bigint);
  const needsApprove =
    allowance == null || (allowance as bigint) < requiredUsdg;

  /// Write hooks (approve + liquidate are separate txs).
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
  } = useWriteContract();
  const { isSuccess: liqSealed } = useWaitForTransactionReceipt({
    hash: liquidateHash,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
  });

  /// Stage transitions on tx milestones.
  useEffect(() => {
    if (approveSealed && stage === "approve-mining") {
      refetchAllowance();
      setStage("idle");
    }
  }, [approveSealed, stage, refetchAllowance]);
  useEffect(() => {
    if (liqSealed && stage === "liquidate-mining") setStage("sealed");
  }, [liqSealed, stage]);

  function onApprove() {
    if (!USDC_ADDRESS || !EQUIFLOW_VAULT_ADDRESS) return;
    setStage("approving");
    writeApprove(
      {
        abi: ERC20_ABI,
        address: USDC_ADDRESS,
        functionName: "approve",
        args: [EQUIFLOW_VAULT_ADDRESS, requiredUsdg],
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        onSuccess: () => setStage("approve-mining"),
        onError: () => setStage("idle"),
      },
    );
  }

  function onLiquidate() {
    if (!EQUIFLOW_VAULT_ADDRESS || !selected) return;
    setStage("liquidating");
    writeLiquidate(
      {
        abi: EQUIFLOW_VAULT_ABI,
        address: EQUIFLOW_VAULT_ADDRESS,
        functionName: "liquidate",
        args: [user, selected.address, debtRepayE18],
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      },
      {
        onSuccess: () => setStage("liquidate-mining"),
        onError: () => setStage("idle"),
      },
    );
  }

  // ── AA flow: USDG.approve + vault.liquidate in ONE UserOperation ────
  async function onBundle() {
    if (!USDC_ADDRESS || !EQUIFLOW_VAULT_ADDRESS || !selected || !smartAccount) {
      return;
    }
    setAaError(null);
    setStage("liquidating");
    try {
      // For 7702 mode: ensure EOA delegation before submitting.
      await prepareForSubmit();

      const calls = [];
      if (needsApprove) {
        calls.push({
          to: USDC_ADDRESS as Address,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [EQUIFLOW_VAULT_ADDRESS, requiredUsdg],
          }),
        });
      }
      calls.push({
        to: EQUIFLOW_VAULT_ADDRESS as Address,
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
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[LiquidateModal] UserOp failed:", err);
      setAaError(msg);
      setStage("idle");
    }
  }

  if (!open) return null;

  const busy =
    stage === "approving" ||
    stage === "approve-mining" ||
    stage === "liquidating" ||
    stage === "liquidate-mining" ||
    approvePending ||
    liqPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(26, 24, 20, 0.55)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-paper border border-ink rounded-[2px] w-full max-w-[560px] mx-4"
        style={{ maxHeight: "92vh", overflow: "auto" }}
      >
        <div className="flex justify-between items-baseline border-b border-ink p-5">
          <div>
            <div className="eyebrow mb-1" style={{ color: "var(--down)" }}>
              At-risk position · liquidate
            </div>
            <div
              className="font-serif font-medium"
              style={{ fontSize: 22, letterSpacing: "-0.02em" }}
            >
              {shortAddr(user)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="bg-transparent border border-hairline rounded-[2px] px-2 py-1 text-ink-soft cursor-pointer hover:text-ink"
            style={{ fontSize: 12 }}
          >
            ✕
          </button>
        </div>

        {/* Snapshot */}
        <div className="grid grid-cols-3 border-b border-hairline-soft">
          {(
            [
              ["Debt", fmt.usd(borrowedUsdNum, 0)],
              ["Collateral", fmt.usd(collateralUsdNum, 0)],
              [
                "Health",
                hfNum === Number.POSITIVE_INFINITY
                  ? "∞"
                  : hfNum.toFixed(3),
                hfNum < 1 ? "down" : undefined,
              ],
            ] as [string, string, "down" | undefined][]
          ).map(([k, v, tone], i) => (
            <div
              key={k}
              className="px-4 py-3"
              style={{
                borderRight: i < 2 ? "1px solid var(--hairline-soft)" : "none",
              }}
            >
              <div className="eyebrow mb-1">{k}</div>
              <div
                className="font-serif font-medium tabular"
                style={{
                  fontSize: 18,
                  letterSpacing: "-0.01em",
                  color: tone === "down" ? "var(--down)" : "var(--ink)",
                }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="p-5">
          {!isConnected ? (
            <div
              className="border border-hairline rounded-[2px] p-4 text-center text-ink-mute"
              style={{ fontSize: 13 }}
            >
              Connect a wallet to liquidate. Your account pays the USDG, the
              vault hands you the seized collateral plus a {bonusPct.toFixed(0)}%
              bonus.
            </div>
          ) : seizableTokens.length === 0 ? (
            <div
              className="border border-hairline rounded-[2px] p-4 text-center text-ink-mute"
              style={{ fontSize: 13 }}
            >
              This position has debt but no on-chain collateral entries —
              cannot liquidate (already drained or read failed).
            </div>
          ) : stage === "sealed" ? (
            <div className="text-center">
              <div
                className="font-serif font-medium"
                style={{ fontSize: 26, letterSpacing: "-0.02em" }}
              >
                Liquidation sealed
              </div>
              <div className="text-ink-soft mt-2" style={{ fontSize: 13 }}>
                You repaid {fmt.usd(debtRepayUsd, 0)} of debt and received
                ~{fmt.usd(collateralValueSeizedUsd, 0)} in {selected?.symbol}.
              </div>
              {liquidateHash && (
                <a
                  href={explorerTx(liquidateHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-4 font-mono text-ink-mute hover:text-ink no-underline border-b border-hairline hover:border-ink"
                  style={{ fontSize: 11 }}
                >
                  View transaction ↗
                </a>
              )}
              <button
                onClick={onClose}
                className="block mx-auto mt-5 bg-ink text-paper border-0 rounded-[2px] px-5 py-2 cursor-pointer"
                style={{ fontSize: 13 }}
              >
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Seize-token selector */}
              <div className="eyebrow mb-2">Seize collateral</div>
              <div className="grid gap-1 mb-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
                {seizableTokens.map((t, i) => (
                  <button
                    key={t.address}
                    onClick={() => setTokenIdx(i)}
                    className="border rounded-[2px] py-2 cursor-pointer font-mono"
                    style={{
                      fontSize: 12,
                      borderColor:
                        i === tokenIdx ? "var(--ink)" : "var(--hairline)",
                      background:
                        i === tokenIdx ? "var(--ink)" : "transparent",
                      color: i === tokenIdx ? "var(--paper)" : "var(--ink)",
                    }}
                  >
                    {t.symbol}
                  </button>
                ))}
              </div>

              {/* Debt-to-repay input */}
              <div className="eyebrow mb-2">Debt to repay (USDG)</div>
              <div
                className="flex items-center gap-2 mb-2"
                style={{
                  border: "1px solid var(--ink)",
                  padding: "10px 12px",
                  borderRadius: 2,
                }}
              >
                <input
                  type="number"
                  value={debtStr}
                  onChange={(e) => setDebtStr(e.target.value)}
                  placeholder="0.00"
                  className="font-serif font-medium tabular bg-transparent border-0 outline-none flex-1 w-full min-w-0"
                  style={{ fontSize: 20, letterSpacing: "-0.02em" }}
                />
                <button
                  onClick={() => setDebtStr(borrowedUsdNum.toFixed(2))}
                  className="bg-transparent border border-hairline-soft rounded-[2px] px-2 py-0.5 cursor-pointer text-ink-soft hover:text-ink"
                  style={{ fontSize: 11 }}
                >
                  Max
                </button>
              </div>
              <div
                className="text-ink-mute mb-4"
                style={{ fontSize: 11 }}
              >
                Up to {fmt.usd(borrowedUsdNum, 2)} · Your USDG balance{" "}
                {usdgBalance != null
                  ? fmt.usd(
                      Number(usdgBalance as bigint) /
                        Math.pow(10, stableDec),
                      2,
                    )
                  : "—"}
              </div>

              {/* Seized preview */}
              <div className="bg-paper-alt rounded-[2px] p-4 mb-4">
                {(
                  [
                    ["You pay", fmt.usd(debtRepayUsd, 2), undefined],
                    [
                      "Collateral seized (incl. " +
                        bonusPct.toFixed(0) +
                        "% bonus)",
                      fmt.usd(collateralValueSeizedUsd, 2),
                      undefined,
                    ],
                    [
                      "Your profit",
                      "+" + fmt.usd(bonusGainedUsd, 2),
                      "up",
                    ],
                  ] as [string, string, "up" | undefined][]
                ).map(([k, v, tone]) => (
                  <div
                    key={k}
                    className="flex justify-between py-1"
                    style={{ fontSize: 12 }}
                  >
                    <span className="text-ink-soft">{k}</span>
                    <span
                      className={`font-mono tabular font-medium ${tone === "up" ? "text-up" : ""}`}
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>

              {/* Warnings */}
              {overDebt && (
                <div
                  className="rounded-[2px] mb-3 px-3 py-2"
                  style={{
                    background: "var(--down-soft)",
                    color: "var(--down)",
                    fontSize: 12,
                  }}
                >
                  Cannot repay more than the outstanding debt.
                </div>
              )}
              {balanceShort && !overDebt && (
                <div
                  className="rounded-[2px] mb-3 px-3 py-2"
                  style={{
                    background: "var(--amber-soft)",
                    color: "var(--amber)",
                    fontSize: 12,
                  }}
                >
                  Your USDG balance is short of the repay amount.
                </div>
              )}

              {/* CTAs */}
              {aaActive && AA_CONFIGURED ? (
                <button
                  onClick={onBundle}
                  disabled={
                    busy || debtRepayUsd <= 0 || overDebt || balanceShort || !selected
                  }
                  className="w-full rounded-[2px] flex justify-between items-center bg-ink text-paper border-0 cursor-pointer font-medium px-4 py-3 disabled:opacity-40"
                  style={{ fontSize: 14 }}
                >
                  <span>
                    {stage === "liquidating"
                      ? "Bundling UserOp…"
                      : `Sign once · liquidate ${selected?.symbol ?? ""}`}
                  </span>
                  <span
                    className="font-mono opacity-60"
                    style={{ fontSize: 11 }}
                  >
                    1 sig · gas sponsored
                  </span>
                </button>
              ) : needsApprove ? (
                <button
                  onClick={onApprove}
                  disabled={busy || debtRepayUsd <= 0 || overDebt || balanceShort}
                  className="w-full rounded-[2px] flex justify-between items-center bg-ink text-paper border-0 cursor-pointer font-medium px-4 py-3 disabled:opacity-40"
                  style={{ fontSize: 14 }}
                >
                  <span>
                    {stage === "approving" || approvePending
                      ? "Awaiting wallet…"
                      : stage === "approve-mining"
                        ? "Approval mining…"
                        : "Approve USDG"}
                  </span>
                  <span
                    className="font-mono opacity-60"
                    style={{ fontSize: 11 }}
                  >
                    step 1 / 2
                  </span>
                </button>
              ) : (
                <button
                  onClick={onLiquidate}
                  disabled={busy || debtRepayUsd <= 0 || overDebt || balanceShort || !selected}
                  className="w-full rounded-[2px] flex justify-between items-center bg-ink text-paper border-0 cursor-pointer font-medium px-4 py-3 disabled:opacity-40"
                  style={{ fontSize: 14 }}
                >
                  <span>
                    {stage === "liquidating" || liqPending
                      ? "Awaiting wallet…"
                      : stage === "liquidate-mining"
                        ? "Liquidating…"
                        : `Liquidate ${selected?.symbol ?? ""}`}
                  </span>
                  <span
                    className="font-mono opacity-60"
                    style={{ fontSize: 11 }}
                  >
                    seize +{bonusPct.toFixed(0)}%
                  </span>
                </button>
              )}
              {aaError && (
                <div
                  className="text-down font-mono mt-2"
                  style={{ fontSize: 10, wordBreak: "break-word" }}
                >
                  UserOp: {aaError.slice(0, 180)}
                </div>
              )}
              {aaTxHash && (
                <a
                  href={explorerTx(aaTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center mt-1 font-mono text-ink-mute hover:text-ink no-underline"
                  style={{ fontSize: 10 }}
                >
                  Bundled UserOp tx ↗
                </a>
              )}
              {approveHash && (
                <a
                  href={explorerTx(approveHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center mt-2 font-mono text-ink-mute hover:text-ink no-underline"
                  style={{ fontSize: 10 }}
                >
                  Approval tx ↗
                </a>
              )}
              {liquidateHash && (
                <a
                  href={explorerTx(liquidateHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center mt-1 font-mono text-ink-mute hover:text-ink no-underline"
                  style={{ fontSize: 10 }}
                >
                  Liquidation tx ↗
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
