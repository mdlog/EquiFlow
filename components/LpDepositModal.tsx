"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData, parseUnits, type Address, type Hex } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  ERC20_ABI,
  EQUIFLOW_VAULT_ABI,
  EQUIFLOW_VAULT_ADDRESS,
  USDC_ADDRESS,
} from "@/lib/contracts";
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
    address: USDC_ADDRESS,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!USDC_ADDRESS },
  });
  const stableDec =
    typeof stableDecimalsRaw === "number" ? stableDecimalsRaw : 6;

  const { data: walletRaw, refetch: refetchWallet } = useReadContract({
    abi: ERC20_ABI,
    address: USDC_ADDRESS,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!USDC_ADDRESS && !!address, refetchInterval: 12_000 },
  });
  const walletUsdg =
    walletRaw !== undefined
      ? Number(walletRaw as bigint) / 10 ** stableDec
      : 0;

  const { data: vaultBookedRaw, refetch: refetchBooked } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS,
    functionName: "bookedUsdg",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!EQUIFLOW_VAULT_ADDRESS, refetchInterval: 12_000 },
  });
  const { data: totalAssetsRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS,
    functionName: "totalAssetsUsd",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!EQUIFLOW_VAULT_ADDRESS, refetchInterval: 12_000 },
  });
  const { data: totalSharesRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS,
    functionName: "totalShares",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!EQUIFLOW_VAULT_ADDRESS, refetchInterval: 12_000 },
  });
  const { data: apyRaw } = useReadContract({
    abi: EQUIFLOW_VAULT_ABI,
    address: EQUIFLOW_VAULT_ADDRESS,
    functionName: "lpApyBps",
    chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    query: { enabled: !!EQUIFLOW_VAULT_ADDRESS, refetchInterval: 12_000 },
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

  const amount = Math.max(0, Number(amountStr) || 0);
  const overBalance = amount > walletUsdg + 0.001;

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
    if (step === "transfer-mining") {
      setStep("registering");
      refetchBooked();
      refetchWallet();
      if (EQUIFLOW_VAULT_ADDRESS) {
        const raw = parseUnits(amount.toFixed(stableDec), stableDec);
        writeContract({
          abi: EQUIFLOW_VAULT_ABI,
          address: EQUIFLOW_VAULT_ADDRESS,
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
    refetchBooked,
    refetchWallet,
  ]);

  useEffect(() => {
    if (mining && step === "transferring") setStep("transfer-mining");
    if (mining && step === "registering") setStep("register-mining");
  }, [mining, step]);

  useEffect(() => {
    if (!open) {
      setAmountStr("");
      setStep("idle");
      reset();
    }
  }, [open, reset]);

  function handleStart() {
    if (!USDC_ADDRESS || !EQUIFLOW_VAULT_ADDRESS) return;
    if (aaActive && smartAccount && AA_CONFIGURED) {
      void handleBundle();
      return;
    }
    setStep("transferring");
    const raw = parseUnits(amount.toFixed(stableDec), stableDec);
    writeContract({
      abi: ERC20_ABI,
      address: USDC_ADDRESS,
      functionName: "transfer",
      args: [EQUIFLOW_VAULT_ADDRESS, raw],
      chainId: ROBINHOOD_CHAIN_TESTNET_ID,
    });
  }

  async function handleBundle() {
    if (!USDC_ADDRESS || !EQUIFLOW_VAULT_ADDRESS || !smartAccount) return;
    setAaError(null);
    setStep("transferring");
    try {
      await prepareForSubmit();
      const raw = parseUnits(amount.toFixed(stableDec), stableDec);
      const amountUsd18 = parseUnits(amount.toFixed(stableDec), stableDec);
      const calls = [
        {
          to: USDC_ADDRESS as Address,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [EQUIFLOW_VAULT_ADDRESS, raw],
          }),
        },
        {
          to: EQUIFLOW_VAULT_ADDRESS as Address,
          data: encodeFunctionData({
            abi: EQUIFLOW_VAULT_ABI,
            functionName: "register",
            args: [amountUsd18],
          }),
        },
      ];
      const { txHash } = await sendUserOp({
        smartAccount,
        calls,
        gasMode: "sponsored",
      });
      setAaTxHash(txHash);
      setStep("sealed");
      refetchBooked();
      refetchWallet();
    } catch (err) {
      console.error("[LpDepositModal] UserOp failed:", err);
      setAaError(err instanceof Error ? err.message : String(err));
      setStep("idle");
    }
  }

  const busy =
    step === "transferring" ||
    step === "transfer-mining" ||
    step === "registering" ||
    step === "register-mining";
  const sealed = step === "sealed";

  const canStart =
    isConnected &&
    !!USDC_ADDRESS &&
    !!EQUIFLOW_VAULT_ADDRESS &&
    amount > 0 &&
    !overBalance &&
    !busy &&
    !sealed;

  let ctaLabel: string;
  if (!isConnected) ctaLabel = "Connect wallet";
  else if (!USDC_ADDRESS || !EQUIFLOW_VAULT_ADDRESS)
    ctaLabel = "Vault not configured";
  else if (step === "transferring") ctaLabel = "Sign transfer…";
  else if (step === "transfer-mining") ctaLabel = "Mining transfer…";
  else if (step === "registering") ctaLabel = "Sign register…";
  else if (step === "register-mining") ctaLabel = "Minting shares…";
  else ctaLabel = `Deposit ${fmt.usd(amount, 2)}`;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      eyebrow="transfer + register · earn from borrow spread"
      title="Deposit USDG · become an LP"
      footer={
        <>
          {overBalance && (
            <ValidationError>
              Exceeds your USDG balance. Claim from faucet or reduce amount.
            </ValidationError>
          )}
          <TxError message={error?.message} />
          {aaError && <TxError message={`UserOp: ${aaError}`} />}
          <TxLink hash={txHash} />
          <TxLink hash={aaTxHash} label="UserOp tx" />
          {sealed && (
            <SealedMessage>
              Deposited {fmt.usd(amount, 2)} · earning {apyPct.toFixed(2)}% APY
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
            Step 1: <span className="font-mono">USDG.transfer(vault)</span> ·
            Step 2: <span className="font-mono">vault.register()</span>
            <br />
            Two signatures because USDG transferFrom is gated by the access
            registry.
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
          label="Idle USDG"
          value={fmt.usd(vaultBookedUsdg, 0)}
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
          >
            max {fmt.usd(walletUsdg, 2)}
          </span>
        </div>
        <div
          className="flex items-center gap-2 bg-paper rounded-[2px]"
          style={{
            padding: "12px 14px",
            border: `1.4px solid ${overBalance ? "var(--down)" : "var(--ink)"}`,
          }}
        >
          <span className="font-mono text-ink-mute" style={{ fontSize: 14 }}>
            $
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            max={walletUsdg}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={!isConnected || busy}
            placeholder="0.00"
            className="font-serif font-medium tabular bg-transparent border-0 outline-none flex-1 w-full min-w-0"
            style={{ fontSize: 22, letterSpacing: "-0.02em" }}
          />
          <span className="font-mono text-ink-soft" style={{ fontSize: 13 }}>
            USDG
          </span>
        </div>
        <div className="flex gap-1.5 mt-2.5">
          {[0.25, 0.5, 0.75, 1].map((frac) => (
            <button
              key={frac}
              type="button"
              onClick={() => setAmountStr((walletUsdg * frac).toFixed(2))}
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
          v={`+${fmt.usd((amount * apyPct) / 100, 2)} / yr`}
          color="var(--up)"
        />
      </div>
    </ModalShell>
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
