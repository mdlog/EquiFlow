"use client";

import { useSessionInfo, type PythSession } from "@/lib/hooks/use-session-info";

/// Compact pill showing which Pyth session is currently driving the price.
/// Color-coded so users can tell at a glance whether they're looking at live
/// regular-hours liquidity or thin overnight pricing.
///
/// Variants:
///   - `dense` — single short label (e.g. "OVN"), good for tight cells
///   - `full` — short label + freshness ago (e.g. "OVERNIGHT · 4s")

const STYLE: Record<PythSession, { bg: string; fg: string; label: string; full: string }> = {
  regular: {
    bg: "rgba(63, 152, 95, 0.14)",
    fg: "var(--up)",
    label: "REG",
    full: "REGULAR",
  },
  pre: {
    bg: "rgba(48, 99, 153, 0.14)",
    fg: "oklch(0.45 0.10 240)",
    label: "PRE",
    full: "PRE-MARKET",
  },
  post: {
    bg: "rgba(151, 92, 47, 0.14)",
    fg: "var(--amber)",
    label: "POST",
    full: "POST-MARKET",
  },
  overnight: {
    bg: "rgba(26, 24, 20, 0.10)",
    fg: "var(--ink)",
    label: "OVN",
    full: "OVERNIGHT",
  },
};

const NEUTRAL = {
  bg: "var(--hairline-soft)",
  fg: "var(--ink-mute)",
  label: "—",
  full: "OFFLINE",
};

interface Props {
  symbol: string;
  /** Variant: "dense" = label only, "full" = label + freshness. */
  variant?: "dense" | "full";
  /** Override CSS font-size. */
  size?: number;
}

export function SessionBadge({ symbol, variant = "dense", size = 9 }: Props) {
  const info = useSessionInfo(symbol);
  const style = info.session ? STYLE[info.session] : NEUTRAL;
  const ageSec =
    info.publishTime > 0
      ? Math.max(0, Math.floor(Date.now() / 1000) - info.publishTime)
      : null;
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
        info.error
          ? `Session info error: ${info.error}`
          : info.session
            ? `${style.full} · last update ${ageLabel} ago${info.price ? ` · Hermes $${info.price.toFixed(2)}` : ""}`
            : "Session offline — using last on-chain price"
      }
    >
      {text}
    </span>
  );
}
