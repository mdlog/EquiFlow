"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData, parseUnits, type Address, type Hex } from "viem";
import {
  useAccount,
  useBalance,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  ERC20_ABI,
  EQUIFLOW_VAULT_ABI,
} from "@/lib/contracts";
import { ROBINHOOD_CHAIN_TESTNET_ID } from "@/lib/config/chain";
import { fmt } from "@/lib/format";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import { sendUserOp } from "@/lib/aa/send-userop";
import { AA_CONFIGURED } from "@/lib/web3/alchemy";
import { useVaultContext } from "@/lib/hooks/use-vault-context";
import {
  ModalActions,
  ModalFootnote,
  ModalShell,
  PreviewRow,
  SealedMessage,
  TxError,
  TxLink,
  ValidationError,
} from "./modal";

/// LP deposit modal (open to anyone).
///
/// Two-step flow:
///   1. transfer:   USDG.transfer(vault, amount)
///   2. register:   vault.register(amount) → mints LP shares
///
/// Why two steps: regulated USDG on Robinhood Chain gates `transferFrom`. We
/// can't have the vault pull tokens itself, so the LP pushes them first then
/// the vault confirms its balance delta and mints shares.

type Step =
  | "idle"
  | "wrapping"
  | "wrapping-mining"
  | "announcing"
  | "announce-mining"
  | "transferring"
  | "transfer-mining"
  | "registering"
  | "register-mining"
  | "sealed";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LpDepositModal({ open, onClose }: Props) {
  const { vault } = useVaultContext();
  const VAULT_ADDR = vault.address;
  const TOKEN_ADDR = vault.tokenAddress;
  const tokenSymbol = vault.borrowSymbol;
  const isWeth = vault.id === "weth";
  const { address: eoaAddress, isConnected } = useAccount();
  const { mode: aaMode, smartAccount, smartAddress, prepareForSubmit } =
    useSmartWallet();
  const aaActive = aaMode !== "off" && smartAccount != null;
  const address = (aaActive && smartAddress ? smartAddress : eoaAddress) as
    | Address
    | undefined;
  const [aaError, setAaError] = useState<string | null>(null);
  const [aaTxHash, setAaTxHash] = useState<Hex | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [step, setStep] = useState<Step>("idle");

  const { data: stableDecimalsRaw } = useReadContract({
    abi: ERC20_ABI,
    address: TOKEN_ADDR,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!TOKEN_ADDR },
  });
  const stableDec =
    typeof stableDecimalsRaw === "number" ? stableDecimalsRaw : vault.tokenDecimals;

  const { data: walletRaw, refetch: refetchWallet } = useReadContract({
    abi: ERC20_ABI,
    address: TOKEN_ADDR,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!TOKEN_ADDR && !!address, refetchInterval: 12_000 },
  });
  const walletWeth =
    walletRaw !== undefined
      ? Number(walletRaw as bigint) / 10 ** stableDec
      : 0;

  const { data: nativeBalData, refetch: refetchNative } = useBalance({
    address,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: isWeth && !!address, refetchInterval: 12_000 },
  });
  const nativeEth = isWeth && nativeBalData
    ? Number(nativeBalData.value) / 10 ** nativeBalData.decimals
    : 0;
  const walletUsdg = isWeth ? walletWeth + nativeEth : walletWeth;

  const { data: vaultBookedRaw, refetch: refetchBooked } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: VAULT_ADDR,
    functionName: "bookedUsdg",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!VAULT_ADDR, refetchInterval: 12_000 },
  });
  const { data: totalAssetsRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: VAULT_ADDR,
    functionName: "totalAssetsUsd",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!VAULT_ADDR, refetchInterval: 12_000 },
  });
  const { data: totalSharesRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: VAULT_ADDR,
    functionName: "totalShares",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!VAULT_ADDR, refetchInterval: 12_000 },
  });
  const { data: apyRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: VAULT_ADDR,
    functionName: "lpApyBps",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!VAULT_ADDR, refetchInterval: 12_000 },
  });

  const vaultBookedUsdg =
    vaultBookedRaw !== undefined
      ? Number(vaultBookedRaw as bigint) / 10 ** stableDec
      : 0;
  const totalAssetsUsd =
    totalAssetsRaw !== undefined ? Number(totalAssetsRaw as bigint) / 1e18 : 0;
  const totalShares =
    totalSharesRaw !== undefined ? Number(totalSharesRaw as bigint) / 1e18 : 0;
  const apyPct = apyRaw !== undefined ? Number(apyRaw as bigint) / 100 : 0;

  const fmtBal = (v: number) =>
    isWeth
      ? `${v < 0.001 && v > 0 ? v.toFixed(6) : v.toFixed(4)} ${tokenSymbol}`
      : fmt.usd(v, 2);

  const amount = Math.max(0, Number(amountStr) || 0);
  const balanceLoaded = walletRaw !== undefined && (!isWeth || nativeBalData !== undefined);
  const overBalance = balanceLoaded && amount > walletUsdg + 0.001;

  const expectedShares =
    totalShares === 0
      ? amount
      : totalAssetsUsd > 0
        ? (amount * totalShares) / totalAssetsUsd
        : 0;

  const { writeContract, data: txHash, isPending, error, reset } =
    useWriteContract();
  const { isLoading: mining, isSuccess: receiptSuccess } =
    useWaitForTransactionReceipt({
      hash: txHash,
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });

  useEffect(() => {
    if (!receiptSuccess) return;
    if (step === "wrapping-mining") {
      setStep("announcing");
      refetchWallet();
      if (VAULT_ADDR) {
        const raw = parseUnits(amount.toFixed(stableDec), stableDec);
        reset();
        writeContract({
          abi: EQUIFLOW_VAULT_ABI,
          address: VAULT_ADDR,
          functionName: "announceDeposit",
          args: [raw],
          chainId: ROBINHOOD_CHAIN_TESTNET_ID,
        });
      }
    } else if (step === "announce-mining") {
      setStep("transferring");
      if (TOKEN_ADDR && VAULT_ADDR) {
        const raw = parseUnits(amount.toFixed(stableDec), stableDec);
        reset();
        writeContract({
          abi: ERC20_ABI,
          address: TOKEN_ADDR,
          functionName: "transfer",
          args: [VAULT_ADDR, raw],
          chainId: ROBINHOOD_CHAIN_TESTNET_ID,
        });
      }
    } else if (step === "transfer-mining") {
      setStep("registering");
      refetchBooked();
      refetchWallet();
      if (VAULT_ADDR) {
        const raw = parseUnits(amount.toFixed(stableDec), stableDec);
        reset();
        writeContract({
          abi: EQUIFLOW_VAULT_ABI,
          address: VAULT_ADDR,
          functionName: "register",
          args: [raw],
          chainId: ROBINHOOD_CHAIN_TESTNET_ID,
        });
      }
    } else if (step === "register-mining") {
      setStep("sealed");
      refetchBooked();
    }
  }, [
    receiptSuccess,
    step,
    amount,
    stableDec,
    writeContract,
    reset,
    refetchBooked,
    refetchWallet,
  ]);

  useEffect(() => {
    if (mining && step === "wrapping") setStep("wrapping-mining");
    if (mining && step === "announcing") setStep("announce-mining");
    if (mining && step === "transferring") setStep("transfer-mining");
    if (mining && step === "registering") setStep("register-mining");
  }, [mining, step]);

  useEffect(() => {
    if (step === "announcing" && isWeth) refetchNative();
  }, [step, isWeth, refetchNative]);

  useEffect(() => {
    if (error && !isPending && step !== "idle" && step !== "sealed") {
      setStep("idle");
    }
  }, [error, isPending, step]);

  useEffect(() => {
    if (!open) {
      setAmountStr("");
      setStep("idle");
      reset();
    }
  }, [open, reset]);

  function handleStart() {
    if (!TOKEN_ADDR || !VAULT_ADDR) return;
    if (aaActive && smartAccount && AA_CONFIGURED) {
      void handleBundle();
      return;
    }
    if (needsWrap) {
      setStep("wrapping");
      const wrapRaw = parseUnits(wrapAmount.toFixed(stableDec), stableDec);
      writeContract({
        abi: [{ type: "function", name: "deposit", inputs: [], outputs: [], stateMutability: "payable" }],
        address: TOKEN_ADDR,
        functionName: "deposit",
        value: wrapRaw,
        chainId: ROBINHOOD_CHAIN_TESTNET_ID,
      });
      return;
    }
    setStep("announcing");
    const raw = parseUnits(amount.toFixed(stableDec), stableDec);
    writeContract({
      abi: EQUIFLOW_VAULT_ABI,
      address: VAULT_ADDR,
      functionName: "announceDeposit",
      args: [raw],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  }

  const needsWrap = isWeth && amount > walletWeth && nativeEth > 0;
  const wrapAmount = needsWrap ? amount - walletWeth : 0;

  async function handleBundle() {
    if (!TOKEN_ADDR || !VAULT_ADDR || !smartAccount) return;
    setAaError(null);
    setStep("transferring");
    try {
      await prepareForSubmit();
      const raw = parseUnits(amount.toFixed(stableDec), stableDec);
      const calls: { to: Address; data: Hex; value?: bigint }[] = [];

      if (needsWrap) {
        const wrapRaw = parseUnits(wrapAmount.toFixed(stableDec), stableDec);
        calls.push({
          to: TOKEN_ADDR as Address,
          data: encodeFunctionData({
            abi: [{ type: "function", name: "deposit", inputs: [], outputs: [], stateMutability: "payable" }],
            functionName: "deposit",
          }),
          value: wrapRaw,
        });
      }

      calls.push(
        {
          to: VAULT_ADDR as Address,
          data: encodeFunctionData({
            abi: EQUIFLOW_VAULT_ABI,
            functionName: "announceDeposit",
            args: [raw],
          }),
        },
        {
          to: TOKEN_ADDR as Address,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [VAULT_ADDR, raw],
          }),
        },
        {
          to: VAULT_ADDR as Address,
          data: encodeFunctionData({
            abi: EQUIFLOW_VAULT_ABI,
            functionName: "register",
            args: [raw],
          }),
        },
      );
      const { txHash } = await sendUserOp({
        smartAccount,
        calls,
        gasMode: "sponsored",
      });
      setAaTxHash(txHash);
      setStep("sealed");
      refetchBooked();
      refetchWallet();
      refetchNative();
    } catch (err) {
      console.error("[LpDepositModal] UserOp failed:", err);
      setAaError(err instanceof Error ? err.message : String(err));
      setStep("idle");
    }
  }

  const busy =
    step === "wrapping" ||
    step === "wrapping-mining" ||
    step === "announcing" ||
    step === "announce-mining" ||
    step === "transferring" ||
    step === "transfer-mining" ||
    step === "registering" ||
    step === "register-mining";
  const sealed = step === "sealed";

  const canStart =
    isConnected &&
    !!TOKEN_ADDR &&
    !!VAULT_ADDR &&
    amount > 0 &&
    !overBalance &&
    !busy &&
    !sealed;

  let ctaLabel: string;
  if (!isConnected) ctaLabel = "Connect wallet";
  else if (!TOKEN_ADDR || !VAULT_ADDR)
    ctaLabel = "Vault not configured";
  else if (step === "wrapping") ctaLabel = "Sign wrap…";
  else if (step === "wrapping-mining") ctaLabel = "Wrapping ETH → WETH…";
  else if (step === "announcing") ctaLabel = "Sign announce…";
  else if (step === "announce-mining") ctaLabel = "Mining announce…";
  else if (step === "transferring") ctaLabel = "Sign transfer…";
  else if (step === "transfer-mining") ctaLabel = "Mining transfer…";
  else if (step === "registering") ctaLabel = "Sign register…";
  else if (step === "register-mining") ctaLabel = "Minting shares…";
  else if (needsWrap)
    ctaLabel = `Wrap ${wrapAmount.toFixed(4)} ETH + Deposit`;
  else ctaLabel = `Deposit ${fmtBal(amount)}`;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      eyebrow="announce + transfer + register · earn from borrow spread"
      title={`Deposit ${tokenSymbol} · become an LP`}
      footer={
        <>
          {overBalance && (
            <ValidationError>
              Exceeds your {tokenSymbol} balance. Claim from faucet or reduce amount.
            </ValidationError>
          )}
          <TxError message={error?.message} />
          {aaError && <TxError message={`UserOp: ${aaError}`} />}
          <TxLink hash={txHash} />
          <TxLink hash={aaTxHash} label="UserOp tx" />
          {sealed && (
            <SealedMessage>
              Deposited {fmtBal(amount)} · earning {apyPct.toFixed(2)}% APY
            </SealedMessage>
          )}
          <ModalActions
            onClose={onClose}
            sealed={sealed}
            cta={{
              label: ctaLabel,
              onClick: handleStart,
              disabled: !canStart,
            }}
          />
          <ModalFootnote>
            Step 1: <span className="font-mono">vault.announceDeposit()</span> ·
            Step 2: <span className="font-mono">{tokenSymbol}.transfer(vault)</span> ·
            Step 3: <span className="font-mono">vault.register()</span>
            <br />
            Three signatures: announce prevents front-running, transfer pushes
            {tokenSymbol}, register mints LP shares.
          </ModalFootnote>
        </>
      }
    >
      {/* Vault stats */}
      <div
        className="border-b border-hairline-soft bg-paper-alt grid grid-cols-3"
        style={{ padding: "14px 24px" }}
      >
        <StatCell label="Vault TVL" value={fmt.usd(totalAssetsUsd, 0)} />
        <StatCell
          label="Current LP APY"
          value={`+${apyPct.toFixed(2)}%`}
          color="var(--up)"
        />
        <StatCell
          label={`Idle ${tokenSymbol}`}
          value={fmtBal(vaultBookedUsdg)}
          last
        />
      </div>

      {/* Input */}
      <div style={{ padding: "18px 24px 12px" }}>
        <div
          className="flex justify-between items-baseline"
          style={{ marginBottom: 8 }}
        >
          <span className="eyebrow">Amount to deposit</span>
          <span
            className="font-mono text-ink-mute tabular"
            style={{ fontSize: 10 }}
            title={
              isWeth
                ? `${nativeEth.toFixed(4)} ETH + ${walletWeth.toFixed(4)} WETH`
                : undefined
            }
          >
            {isWeth ? (
              <>
                max {walletUsdg.toFixed(4)}{" "}
                <span className="text-ink-mute opacity-60">
                  ({nativeEth.toFixed(4)} ETH + {walletWeth.toFixed(4)} WETH)
                </span>
              </>
            ) : (
              <>max {fmtBal(walletUsdg)}</>
            )}
          </span>
        </div>
        <div
          className="flex items-center gap-2 bg-paper rounded-[2px]"
          style={{
            padding: "12px 14px",
            border: `1.4px solid ${overBalance ? "var(--down)" : "var(--ink)"}`,
          }}
        >
          {vault.id === "usdg" && (
            <span className="font-mono text-ink-mute" style={{ fontSize: 14 }}>
              $
            </span>
          )}
          <input
            type="number"
            step={vault.id === "weth" ? "0.0001" : "0.01"}
            min="0"
            max={walletUsdg}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={!isConnected || busy}
            placeholder="0.00"
            className="font-serif font-medium tabular bg-transparent border-0 outline-none flex-1 w-full min-w-0"
            style={{ fontSize: 22, letterSpacing: "-0.02em" }}
          />
          <TokenDropdown />
        </div>
        <div className="flex gap-1.5 mt-2.5">
          {[0.25, 0.5, 0.75, 1].map((frac) => (
            <button
              key={frac}
              type="button"
              onClick={() => setAmountStr((walletUsdg * frac).toFixed(isWeth ? 6 : 2))}
              disabled={!isConnected || walletUsdg <= 0}
              className="bg-transparent border border-hairline rounded-[2px] hover:border-ink transition-colors"
              style={{ padding: "4px 9px", fontSize: 10 }}
            >
              {frac === 1 ? "MAX" : `${frac * 100}%`}
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
          You receive
        </div>
        <PreviewRow
          k="LP shares minted"
          v={
            expectedShares > 0
              ? expectedShares.toFixed(expectedShares < 1 ? 4 : 2)
              : "—"
          }
        />
        <PreviewRow
          k="Pool ownership"
          v={
            totalShares + expectedShares > 0
              ? `${((expectedShares / (totalShares + expectedShares)) * 100).toFixed(2)}%`
              : "—"
          }
        />
        <PreviewRow
          k="Estimated yearly"
          v={`+${fmtBal((amount * apyPct) / 100)} / yr`}
          color="var(--up)"
        />
      </div>
    </ModalShell>
  );
}

function TokenDropdown() {
  const { vaultId, setVaultId, activeVaults } = useVaultContext();
  const current = activeVaults.find((v) => v.id === vaultId) ?? activeVaults[0];
  const [dropOpen, setDropOpen] = useState(false);

  if (activeVaults.length <= 1) {
    return (
      <span className="font-mono text-ink-soft" style={{ fontSize: 13 }}>
        {current.borrowSymbol}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setDropOpen((o) => !o)}
        className="flex items-center gap-1.5 border border-hairline rounded-[2px] bg-paper-alt hover:border-ink transition-colors"
        style={{ padding: "4px 10px 4px 8px", fontSize: 13 }}
      >
        <span className="font-mono font-medium">{current.borrowSymbol}</span>
        <span style={{ fontSize: 8 }}>{dropOpen ? "▲" : "▼"}</span>
      </button>
      {dropOpen && (
        <div
          className="absolute right-0 mt-1 border border-ink rounded-[2px] bg-paper z-50 overflow-hidden"
          style={{ minWidth: 120 }}
        >
          {activeVaults.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                setVaultId(v.id);
                setDropOpen(false);
              }}
              className="w-full text-left flex items-center justify-between gap-3 hover:bg-paper-alt transition-colors border-0"
              style={{
                padding: "8px 12px",
                fontSize: 12,
                background: v.id === vaultId ? "var(--paper-alt)" : "transparent",
              }}
            >
              <span className="font-mono font-medium">{v.borrowSymbol}</span>
              {v.id === vaultId && (
                <span style={{ fontSize: 10 }}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCell({
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
      style={{
        padding: "0 14px",
        borderRight: last ? "none" : "1px solid var(--hairline-soft)",
      }}
    >
      <div className="eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>
        {label}
      </div>
      <div
        className="font-serif font-medium tabular"
        style={{
          fontSize: 18,
          letterSpacing: "-0.02em",
          color: color ?? "var(--ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
