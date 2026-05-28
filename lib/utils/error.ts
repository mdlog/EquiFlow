import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
} from "viem";

/// Convert any thrown value to a single-line human-readable string. Use at
/// log boundaries — never echo to UI directly because viem errors include
/// RPC URLs (which may embed API keys).
export function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/// Parse a thrown value from a wagmi/viem call into a short user-facing
/// string. Distinguishes wallet-rejected, contract revert (with errorName),
/// and unknown failures. Safe to render to the user — does NOT include
/// RPC URLs or stack traces.
///
/// Returns `null` for a null/undefined input so render-site `<TxError>` can
/// suppress the row entirely on first render (when `useWriteContract().error`
/// is still null). Catch-handler call sites pass a thrown value and always
/// receive a string; if they want a fallback for an unknown-but-non-null
/// thrown value, append `?? "Unknown error"` at the call site.
export function friendlyError(err: unknown): string | null {
  if (err == null) return null;
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) {
      return "Cancelled in wallet";
    }
    const reverted = err.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError | null;
    if (reverted?.data?.errorName) {
      const args = reverted.data.args ?? [];
      const argsStr =
        args.length > 0
          ? `(${args.map((a) => String(a)).join(", ")})`
          : "";
      return `${humanizeRevert(reverted.data.errorName)}${argsStr}`;
    }
    return err.shortMessage || err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/// Convert custom-error names from EquiFlowVault.sol into friendly copy.
/// Extend as new errors appear in the ABI.
function humanizeRevert(name: string): string {
  switch (name) {
    case "ExceedsLtv":
      return "Borrow would exceed the LTV cap";
    case "InsufficientCollateral":
      return "Insufficient collateral for that action";
    case "StalePrice":
      return "Oracle price is stale — wait for the next keeper tick";
    case "NotListed":
      return "Asset is not listed in this vault";
    case "Paused":
      return "Vault is paused";
    case "ZeroAmount":
      return "Amount must be greater than zero";
    case "DebtExists":
      return "Repay outstanding debt before withdrawing";
    case "InsufficientBalance":
      return "Insufficient balance";
    default:
      return name;
  }
}
