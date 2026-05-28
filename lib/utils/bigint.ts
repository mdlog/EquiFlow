import { parseUnits } from "viem";
import { USDG_USD_DECIMALS } from "@/lib/config/constants";

/// Convert a USD `Number` to USDG-scale `bigint` (1e18) without floating drift.
/// Prefer string-based callers (`parseUnits(rawString, 18)`) — this helper is
/// for cases where the source is genuinely numeric (computed previews, slider
/// values). Returns 0n for non-positive inputs.
export function usdToE18Safe(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n;
  return parseUnits(usd.toFixed(USDG_USD_DECIMALS), USDG_USD_DECIMALS);
}

/// Parse a free-form amount string from a numeric `<input>` into a bigint.
/// Strips commas and validates against `decimals`. Returns 0n on empty or
/// invalid input — modal callers should still gate submit on the source
/// string being non-empty, this helper does not throw.
export function parseAmount(raw: string, decimals: number): bigint {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned || cleaned === ".") return 0n;
  if (!/^\d*\.?\d*$/.test(cleaned)) return 0n;
  try {
    return parseUnits(cleaned as `${number}`, decimals);
  } catch {
    return 0n;
  }
}
