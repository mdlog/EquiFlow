"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { Address } from "viem";
import { fmt } from "@/lib/format";
import { useActiveWallet } from "@/lib/hooks/use-active-wallet";
import { useSmartWallet } from "@/lib/aa/use-smart-wallet";
import {
  registerSessionKey,
  type SessionPermissions,
} from "@/lib/aa/session-key";
import { friendlyError } from "@/lib/utils/error";
import {
  txErrorToast,
  txPendingToast,
  txSealedToast,
} from "@/lib/utils/tx-toast";
import {
  ModalActions,
  ModalFootnote,
  ModalShell,
  SealedMessage,
  TxError,
  TxLink,
} from "./modal";

/// Auto-Defender modal — pre-authorizes the EquiFlow keeper to call
/// `vault.repayDebt()` on the user's position when health-factor drops below
/// a threshold, up to a weekly USDG limit, expiring after `days`.
///
/// Three sliders. One signature. One UserOp.

interface Props {
  open: boolean;
  onClose: () => void;
  /// Whitelisted collateral tokens — the modal embeds these in the session's
  /// permission scope so the keeper can only repay against assets the user
  /// actually holds. Empty = "any".
  collateralTokens: Address[];
  /// Refresh callback so the parent can re-fetch /api/defender/status after
  /// successful enable.
  onSuccess?: () => void;
}

type Stage = "idle" | "signing" | "submitting" | "sealed" | "error";

const DAYS = 86400;

export function AutoDefenderModal({
  open,
  onClose,
  collateralTokens,
  onSuccess,
}: Props) {
  const { isConnected, isSmartWallet, address } = useActiveWallet();
  const { smartAccount } = useSmartWallet();

  const [threshold, setThreshold] = useState(1.15);
  const [weeklyLimit, setWeeklyLimit] = useState(500);
  const [expiryDays, setExpiryDays] = useState(30);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [opHash, setOpHash] = useState<string | null>(null);
  const [toastId, setToastId] = useState<string | number | null>(null);
  const thresholdId = useId();
  const weeklyId = useId();
  const expiryId = useId();

  useEffect(() => {
    if (!open) {
      setStage("idle");
      setError(null);
      setOpHash(null);
      setToastId(null);
    }
  }, [open]);

  const expiresAt = useMemo(
    () => Math.floor(Date.now() / 1000) + expiryDays * DAYS,
    [expiryDays],
  );
  const expiryLabel = useMemo(() => {
    const d = new Date(expiresAt * 1000);
    return d.toISOString().slice(0, 10);
  }, [expiresAt]);

  const busy = stage === "signing" || stage === "submitting";
  const sealed = stage === "sealed";

  const canSign =
    !!isConnected && !!isSmartWallet && !!smartAccount && !!address &&
    stage === "idle";

  async function handleSign() {
    if (!smartAccount || !address) return;
    setError(null);
    setStage("signing");
    const id = txPendingToast({
      action: `Authorize keeper for ${expiryDays}d`,
    });
    setToastId(id);
    try {
      const permissions: SessionPermissions = {
        weeklyLimitUsdg: BigInt(Math.round(weeklyLimit * 1_000_000)),
        healthThreshold: BigInt(Math.round(threshold * 1e6)) * BigInt(1e12),
        expiresAt,
        collateralTokens,
      };
      setStage("submitting");
      const stored = await registerSessionKey({
        smartAccount,
        smartWalletAddress: address,
        permissions,
      });
      setOpHash(stored.installUserOpHash ?? null);
      setStage("sealed");
      txSealedToast(id, {
        action: "Auto-Defender authorized",
        txHash: stored.installUserOpHash ?? null,
      });
      onSuccess?.();
    } catch (err) {
      setError(friendlyError(err));
      txErrorToast(id, err);
      setStage("error");
    }
  }

  let cta: string;
  if (!isConnected) cta = "Connect wallet";
  else if (!isSmartWallet) cta = "Enable Smart wallet first";
  else if (stage === "signing") cta = "Sign in your wallet…";
  else if (stage === "submitting") cta = "Submitting UserOp…";
  else cta = `Sign · authorize keeper for ${expiryDays}d`;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      variant="centered"
      width={540}
      eyebrow="BETA · off-chain authorization (on-chain validator pending)"
      title="Enable Auto-Defender"
      footer={
        <>
          {!isSmartWallet && isConnected && (
            <div className="text-amber font-mono" style={{ fontSize: 11 }}>
              Switch to Smart wallet mode in the header to enable session keys.
              Session keys require ERC-4337.
            </div>
          )}
          <TxError message={error} />
          <TxLink hash={opHash} label="install op" />
          {sealed && (
            <SealedMessage>
              Keeper has been authorized. You can sleep now.
            </SealedMessage>
          )}
          <ModalActions
            onClose={onClose}
            sealed={sealed}
            cta={{
              label: cta,
              onClick: handleSign,
              disabled: !canSign || busy,
              busy,
            }}
          />
          <ModalFootnote>
            Calls <span className="font-mono">installValidation()</span> via
            sponsored UserOp · session key stored only in your browser
          </ModalFootnote>
        </>
      }
    >
      {/* Intro */}
      <div
        className="border-b border-hairline-soft bg-paper-alt"
        style={{ padding: "14px 24px", fontSize: 12, lineHeight: 1.55 }}
      >
        <span className="text-ink">
          Authorize the EquiFlow keeper to call <code>repayDebt()</code> on
          your position when health-factor drops below a threshold.
        </span>
        <span className="text-ink-mute">
          {" "}Stays in scope only for the limits you set. You can revoke at
          any time.
        </span>

        {/* BETA disclosure — the install UserOp this modal submits does NOT
            currently land an on-chain validator (Modular Account v2
            `installValidation` is pending a published validator module on
            RBN testnet). Limits are enforced off-chain by the keeper. The
            keeper sweep stays in `dry_run` until the on-chain path ships.
            Be honest with users about what's enforced and what isn't. */}
        <div
          className="border border-hairline-soft bg-paper-alt"
          style={{
            marginTop: 12,
            padding: "10px 12px",
            fontSize: 11,
            lineHeight: 1.5,
            color: "var(--amber)",
          }}
        >
          <strong>BETA / off-chain enforcement.</strong>{" "}
          Until Modular Account v2's <code>installValidation()</code> path lands,
          these limits are stored on the keeper backend, not enforced by your
          smart wallet on-chain. The keeper currently runs in dry-run and will
          not move funds. We will require a re-authorization when the on-chain
          path ships.
        </div>
      </div>

      {/* Sliders */}
      <div style={{ padding: "20px 24px 4px" }}>
        <SliderRow
          id={thresholdId}
          label="Health-factor trigger"
          valueLabel={`HF < ${threshold.toFixed(2)}`}
          sub={
            threshold <= 1.1
              ? "Aggressive · acts very close to liquidation"
              : threshold >= 1.25
                ? "Conservative · early intervention"
                : "Balanced default"
          }
          min={1.05}
          max={1.3}
          step={0.01}
          value={threshold}
          onChange={setThreshold}
          disabled={busy || sealed}
        />
        <SliderRow
          id={weeklyId}
          label="Max weekly repay"
          valueLabel={fmt.usd(weeklyLimit, 0)}
          sub={`per rolling 7-day window · resets ${new Date(Date.now() + 7 * DAYS * 1000).toISOString().slice(0, 10)}`}
          min={50}
          max={5000}
          step={50}
          value={weeklyLimit}
          onChange={setWeeklyLimit}
          disabled={busy || sealed}
          unit="USDG"
        />
        <SliderRow
          id={expiryId}
          label="Expires after"
          valueLabel={`${expiryDays}d`}
          sub={`Auto-revokes ${expiryLabel}`}
          min={1}
          max={90}
          step={1}
          value={expiryDays}
          onChange={setExpiryDays}
          disabled={busy || sealed}
        />
      </div>

      {/* Summary preview */}
      <div
        className="border-t border-hairline-soft"
        style={{ padding: "14px 24px 12px" }}
      >
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Authorization summary
        </div>
        <div
          className="bg-paper-alt border border-hairline-soft font-mono"
          style={{
            padding: "12px 14px",
            fontSize: 11,
            lineHeight: 1.6,
            color: "var(--ink)",
          }}
        >
          <span className="text-ink-mute">Keeper may call </span>
          <span className="font-semibold">vault.repayDebt()</span>
          <span className="text-ink-mute"> up to </span>
          <span className="font-semibold">{fmt.usd(weeklyLimit, 0)}/week</span>
          <span className="text-ink-mute"> when </span>
          <span className="font-semibold">HF &lt; {threshold.toFixed(2)}</span>
          <span className="text-ink-mute">, expires </span>
          <span className="font-semibold">{expiryLabel}</span>
          <span className="text-ink-mute">.</span>
          {collateralTokens.length > 0 && (
            <div className="text-ink-mute" style={{ marginTop: 6 }}>
              Limited to {collateralTokens.length} collateral token
              {collateralTokens.length === 1 ? "" : "s"} you currently hold.
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function SliderRow({
  id,
  label,
  valueLabel,
  sub,
  min,
  max,
  step,
  value,
  onChange,
  disabled,
  unit,
}: {
  id: string;
  label: string;
  valueLabel: string;
  sub: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  unit?: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        className="flex justify-between items-baseline"
        style={{ marginBottom: 6 }}
      >
        <label htmlFor={id} className="eyebrow">
          {label}
        </label>
        <span
          className="font-mono tabular font-semibold"
          style={{ fontSize: 13 }}
        >
          {valueLabel}
          {unit && (
            <span className="text-ink-mute" style={{ fontWeight: 400 }}>
              {" "}
              {unit}
            </span>
          )}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-describedby={`${id}-sub`}
        className="w-full"
        style={{
          accentColor: "var(--ink)",
          opacity: disabled ? 0.5 : 1,
        }}
      />
      <div
        id={`${id}-sub`}
        className="font-mono text-ink-mute"
        style={{ fontSize: 10, marginTop: 4 }}
      >
        {sub}
      </div>
    </div>
  );
}
