"use client";

import { useId } from "react";

/// HF risk zones, per industry baseline (Aave/Spark/Morpho parity):
///   HF < 1.0  → Liquidatable (red)
///   HF 1.0-1.3 → At risk     (red, near-zone)
///   HF 1.3-2.0 → Caution     (amber)
///   HF > 2.0  → Safe         (green)
const ZONES = [
  { upTo: 1.0, color: "var(--down)", label: "Liquidatable" },
  { upTo: 1.3, color: "var(--down)", label: "At risk" },
  { upTo: 2.0, color: "var(--amber)", label: "Caution" },
  { upTo: 3.0, color: "var(--up)", label: "Safe" },
] as const;

const MAX_HF_DISPLAY = 3.0;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function zoneFor(hf: number): (typeof ZONES)[number] {
  for (const z of ZONES) {
    if (hf < z.upTo) return z;
  }
  // ZONES is non-empty so this fallback is reachable only when hf >= 3.
  return ZONES[ZONES.length - 1] ?? ZONES[0]!;
}

function pctFor(hf: number): number {
  // Compress >3 to 100% so the bar doesn't run off the end for safe positions.
  const c = clamp(hf, 0, MAX_HF_DISPLAY);
  return (c / MAX_HF_DISPLAY) * 100;
}

interface Props {
  /// Current on-chain HF before the action — pass `Infinity` when there is no
  /// outstanding debt (the meter renders empty with a "no debt" label).
  before: number;
  /// Projected HF after the user signs this tx.
  after: number;
  /// Optional title override.
  label?: string;
}

/// Reusable HF gauge bar used in Borrow/Repay/Withdraw/Liquidate modals.
/// Shows a 3-zone background (red/amber/green), a "before" tick, and an
/// "after" marker so the user can see how the proposed action moves them.
export function HealthFactorMeter({ before, after, label = "Health factor" }: Props) {
  const labelId = useId();
  const noDebt = !Number.isFinite(before);
  const beforePct = noDebt ? 100 : pctFor(before);
  const afterPct = pctFor(after);
  const afterZone = zoneFor(after);

  return (
    <div
      className="border border-hairline bg-paper-alt"
      style={{
        padding: "12px 14px",
        borderRadius: "var(--radius-xs)",
      }}
      role="group"
      aria-labelledby={labelId}
    >
      <div className="flex items-baseline justify-between mb-2">
        <span id={labelId} className="eyebrow">
          {label}
        </span>
        <span
          className="font-mono tabular"
          style={{ fontSize: "var(--text-body-lg)", fontWeight: 500 }}
        >
          {noDebt ? "—" : before.toFixed(2)}{" "}
          <span aria-hidden="true" style={{ opacity: 0.4 }}>
            →
          </span>{" "}
          <span style={{ color: afterZone.color }}>
            {Number.isFinite(after) ? after.toFixed(2) : "∞"}
          </span>
        </span>
      </div>

      {/* Zone bar */}
      <div
        className="relative"
        style={{
          height: 8,
          background:
            "linear-gradient(to right, var(--down) 0%, var(--down) 33.33%, var(--amber) 33.33%, var(--amber) 66.66%, var(--up) 66.66%, var(--up) 100%)",
          borderRadius: 2,
        }}
        aria-hidden="true"
      >
        {/* Before marker (small tick) */}
        {!noDebt && (
          <div
            style={{
              position: "absolute",
              top: -3,
              left: `calc(${beforePct}% - 1px)`,
              width: 2,
              height: 14,
              background: "var(--ink-soft)",
              opacity: 0.45,
            }}
          />
        )}
        {/* After marker (bold) */}
        <div
          style={{
            position: "absolute",
            top: -5,
            left: `calc(${afterPct}% - 2px)`,
            width: 4,
            height: 18,
            background: "var(--ink)",
            borderRadius: 1,
          }}
        />
      </div>

      <div
        className="flex justify-between font-mono mt-1"
        style={{
          fontSize: "var(--text-eyebrow)",
          color: "var(--ink-mute)",
        }}
        aria-hidden="true"
      >
        <span>1.0</span>
        <span>2.0</span>
        <span>3.0+</span>
      </div>

      <span
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {noDebt
          ? `After this action, health factor will be ${
              Number.isFinite(after) ? after.toFixed(2) : "infinity"
            } (${afterZone.label}).`
          : `Health factor moves from ${before.toFixed(2)} to ${
              Number.isFinite(after) ? after.toFixed(2) : "infinity"
            } (${afterZone.label}).`}
      </span>
    </div>
  );
}
