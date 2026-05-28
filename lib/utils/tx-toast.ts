"use client";

import { toast } from "sonner";
import { explorerTx } from "@/lib/contracts";
import { friendlyError } from "@/lib/utils/error";
import type { Hex } from "viem";

/// Persistent toast helpers for write transactions. The point: when the user
/// closes a modal mid-tx, the toast survives at the page level so they keep
/// visibility of "approve → repay → sealed" without staring at the modal.

interface TxStartOpts {
  /// e.g. "Repay $1,234"
  action: string;
  /// Existing toast id to update, when this is the second leg of a sequence.
  id?: string | number;
}

/// Show a non-dismissable "Pending" toast. Returns the toast id so you can
/// call `txSealedToast(id, ...)` once the tx confirms.
export function txPendingToast({ action, id }: TxStartOpts): string | number {
  return toast.loading(`${action}…`, { id, duration: Infinity });
}

interface TxSealedOpts {
  action: string;
  txHash?: Hex | string | null;
}

export function txSealedToast(
  id: string | number,
  { action, txHash }: TxSealedOpts,
): void {
  const url = typeof txHash === "string" && txHash ? explorerTx(txHash) : null;
  toast.success(`${action} sealed`, {
    id,
    duration: 6_000,
    action: url
      ? { label: "View tx ↗", onClick: () => window.open(url, "_blank") }
      : undefined,
  });
}

export function txErrorToast(
  id: string | number | undefined,
  err: unknown,
): void {
  const message = friendlyError(err);
  if (id !== undefined) {
    toast.error(message, { id, duration: 8_000 });
  } else {
    toast.error(message, { duration: 8_000 });
  }
}
