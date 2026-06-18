"use client";

import { useStockPrice, type PriceSource } from "@/lib/hooks/use-adapter-price";

/// Compact pill showing where the displayed price comes from and whether it is
/// live. Color-coded so users can tell at a glance whether they're looking at
/// a live feed (xStock 24/7 or NYSE regular hours) or a frozen last close.
///
/// Variants:
///   - `dense` — single short label (e.g. "xS"), good for tight cells
///   - `full` — short label + freshness (e.g. "xSTOCK · LIVE · 3s")

const STYLE: Record<PriceSource, { bg: string; fg: string; label: string; full: string }> = {
  xstock: {
    bg: "rgba(63, 152, 95, 0.14)",
    fg: "var(--up)",
    label: "xS",
    full: "xSTOCK · LIVE",
  },
  equity: {
    bg: "rgba(63, 152, 95, 0.14)",
    fg: "var(--up)",
    label: "NYSE",
    full: "NYSE · LIVE",
  },
  closed: {
    bg: "rgba(151, 92, 47, 0.14)",
    fg: "var(--amber)",
    label: "CLD",
    full: "CLOSED",
  },
  static: {
    bg: "var(--hairline-soft)",
    fg: "var(--ink-mute)",
    label: "—",
    full: "OFFLINE",
  },
};

interface Props {
  symbol: string;
  /** Variant: "dense" = label only, "full" = label + freshness. */
  variant?: "dense" | "full";
  /** Override CSS font-size. */
  size?: number;
}

export function SessionBadge({ symbol, variant = "dense", size = 9 }: Props) {
  const { source, updatedAt } = useStockPrice(symbol);
  const style = STYLE[source];
  const ageSec =
    updatedAt > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - updatedAt) : null;
  const ageLabel =
    ageSec === null
      ? ""
      : ageSec < 60
        ? `${ageSec}s`
        : ageSec < 3600
          ? `${Math.floor(ageSec / 60)}m`
          : `${Math.floor(ageSec / 3600)}h`;

  const text =
    variant === "full"
      ? `${style.full}${ageLabel ? ` · ${ageLabel}` : ""}`
      : style.label;

  return (
    <span
      className="font-mono uppercase inline-flex items-center rounded-[2px]"
      style={{
        fontSize: size,
        letterSpacing: "0.06em",
        padding: "1px 5px",
        background: style.bg,
        color: style.fg,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
      title={
        source === "closed"
          ? `Market closed — showing last NYSE close${ageLabel ? ` (${ageLabel} ago)` : ""}`
          : source === "static"
            ? "No live price — using static reference"
            : `${style.full}${ageLabel ? ` · updated ${ageLabel} ago` : ""}`
      }
    >
      {text}
    </span>
  );
}
