"use client";

import type { ReactNode } from "react";
import type { Hex } from "viem";
import { explorerAddr, explorerTx, shortAddr } from "@/lib/contracts";

/// Small pieces every modal footer composes. Each is independently optional so
/// modals can show only what's relevant to their current flow stage.

export function TxError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div
      className="text-down font-mono"
      style={{ fontSize: 10, wordBreak: "break-word" }}
    >
      {message.slice(0, 200)}
    </div>
  );
}

/// Inline validation line (LTV exceed, insufficient balance, etc). Smaller
/// font than TxError because it's per-keystroke, not a wallet rejection.
/// Accepts `id` so callers can wire `<input aria-describedby={errorId}>`
/// for WCAG SC 3.3.1 (Error Identification).
export function ValidationError({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="alert"
      className="text-down font-mono"
      style={{ fontSize: 11 }}
    >
      {children}
    </div>
  );
}

export function TxLink({
  hash,
  label = "tx",
}: {
  hash: Hex | string | null | undefined;
  label?: string;
}) {
  if (!hash) return null;
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-ink-soft hover:text-ink no-underline"
      style={{ fontSize: 10 }}
    >
      {label} {shortAddr(hash, 10, 8)} ↗
    </a>
  );
}

export function SealedMessage({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-up" style={{ fontSize: 11 }}>
      ✓ {children}
    </div>
  );
}

interface ActionsProps {
  onClose: () => void;
  sealed: boolean;
  cta?: {
    label: ReactNode;
    onClick: () => void;
    disabled?: boolean;
    /// Set true while a tx is mining so SR users hear "busy". WCAG SC 4.1.3.
    busy?: boolean;
  };
}

/// Cancel + CTA pair. When sealed, hides CTA and renames Cancel → Close so the
/// user has a single obvious dismiss action.
export function ModalActions({ onClose, sealed, cta }: ActionsProps) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onClose}
        className="flex-1 bg-transparent text-ink border border-hairline rounded-[2px] font-medium"
        style={{ padding: "11px 14px", fontSize: 13 }}
      >
        {sealed ? "Close" : "Cancel"}
      </button>
      {!sealed && cta && (
        <button
          type="button"
          onClick={cta.onClick}
          disabled={cta.disabled}
          aria-busy={cta.busy ? true : undefined}
          className="flex-1 bg-ink text-paper rounded-[2px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ padding: "11px 14px", fontSize: 13 }}
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

export function ModalFootnote({ children }: { children: ReactNode }) {
  return (
    <div className="text-ink-mute text-center" style={{ fontSize: 10 }}>
      {children}
    </div>
  );
}

/// "Contract · 0xabc…1234 ↗" trust line shown above the CTA. Lets the user
/// verify which deployment is about to receive their signature before they
/// sign — important for phishing/typosquat resistance on testnets.
export function ContractTrustLine({
  address,
  label = "Contract",
}: {
  address: string | undefined;
  label?: string;
}) {
  if (!address) return null;
  return (
    <div
      className="font-mono text-center"
      style={{ fontSize: 10, color: "var(--ink-mute)" }}
    >
      {label} ·{" "}
      <a
        href={explorerAddr(address)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink-mute hover:text-ink no-underline"
      >
        {shortAddr(address)} ↗
      </a>
    </div>
  );
}
