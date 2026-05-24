"use client";

import { useState } from "react";
import type { LtvRecommendation } from "@/lib/risk/ltv-model";

const SEGMENTS: Array<{
  key: keyof LtvRecommendation["components"];
  label: string;
  color: string;
}> = [
  { key: "varBps", label: "Value-at-Risk (5d, 99.9%)", color: "#ef4444" },
  { key: "liqBonusBps", label: "Liquidation bonus", color: "#f97316" },
  { key: "oracleLagBps", label: "Oracle lag cushion", color: "#eab308" },
  { key: "safetyBps", label: "Safety buffer", color: "#8b5cf6" },
  { key: "gapRiskBps", label: "Overnight gap risk", color: "#6366f1" },
];

export function LtvBreakdown({
  recommendation,
  defaultOpen = false,
}: {
  recommendation: LtvRecommendation;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { ltvBps, tier, components } = recommendation;
  const ltvPct = (ltvBps / 100).toFixed(1);

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="font-mono text-ink-soft uppercase hover:text-ink transition-colors"
        style={{ fontSize: 10, letterSpacing: "0.04em" }}
      >
        {open ? "▾" : "▸"} LTV methodology
      </button>

      {open && (
        <div
          className="mt-2 border border-hairline rounded-[2px] bg-paper-alt"
          style={{ padding: "12px 14px" }}
        >
          {/* Tier badge */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className="font-mono uppercase px-1.5 py-0.5 rounded-[2px]"
              style={{
                fontSize: 9,
                letterSpacing: "0.06em",
                background: "var(--ink)",
                color: "var(--paper)",
              }}
            >
              Tier {tier.level}
            </span>
            <span
              className="font-mono text-ink-soft"
              style={{ fontSize: 10 }}
            >
              {tier.label}
            </span>
          </div>

          {/* Stacked bar */}
          <div
            className="w-full flex rounded-[2px] overflow-hidden mb-3"
            style={{ height: 14 }}
          >
            <div
              style={{
                width: `${ltvBps / 100}%`,
                background: "#22c55e",
              }}
              title={`Recommended LTV: ${ltvPct}%`}
            />
            {SEGMENTS.map((seg) => {
              const val = components[seg.key] as number;
              if (val <= 0) return null;
              return (
                <div
                  key={seg.key}
                  style={{
                    width: `${val / 100}%`,
                    background: seg.color,
                    opacity: 0.7,
                  }}
                  title={`${seg.label}: −${(val / 100).toFixed(1)}%`}
                />
              );
            })}
          </div>

          {/* Legend row */}
          <div
            className="flex items-center gap-3 mb-3 flex-wrap"
            style={{ fontSize: 9 }}
          >
            <span className="flex items-center gap-1 font-mono text-ink-soft">
              <span
                className="inline-block rounded-[1px]"
                style={{ width: 8, height: 8, background: "#22c55e" }}
              />
              LTV {ltvPct}%
            </span>
            {SEGMENTS.map((seg) => {
              const val = components[seg.key] as number;
              if (val <= 0) return null;
              return (
                <span
                  key={seg.key}
                  className="flex items-center gap-1 font-mono text-ink-soft"
                >
                  <span
                    className="inline-block rounded-[1px]"
                    style={{
                      width: 8,
                      height: 8,
                      background: seg.color,
                      opacity: 0.7,
                    }}
                  />
                  {(val / 100).toFixed(1)}%
                </span>
              );
            })}
          </div>

          {/* Component rows */}
          <div className="border-t border-hairline-soft">
            {SEGMENTS.map((seg) => {
              const val = components[seg.key] as number;
              return (
                <div
                  key={seg.key}
                  className="flex justify-between items-center py-1.5 border-b border-hairline-soft last:border-b-0"
                >
                  <span
                    className="font-mono text-ink-mute uppercase"
                    style={{ fontSize: 9, letterSpacing: "0.04em" }}
                  >
                    {seg.label}
                  </span>
                  <span
                    className="font-mono tabular text-ink-soft"
                    style={{ fontSize: 10 }}
                  >
                    −{(val / 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
            <div className="flex justify-between items-center py-1.5 border-t border-hairline">
              <span
                className="font-mono uppercase font-medium"
                style={{ fontSize: 10, letterSpacing: "0.04em" }}
              >
                Recommended max LTV
              </span>
              <span
                className="font-mono tabular font-medium"
                style={{ fontSize: 12 }}
              >
                {ltvPct}%
              </span>
            </div>
          </div>

          {/* Formula note */}
          <p
            className="font-mono text-ink-mute mt-2"
            style={{ fontSize: 9, lineHeight: 1.5 }}
          >
            LTV = 100% − VaR(σ,τ,α) − bonus − oracle − safety − gap.
            VaR uses 99.9% confidence, 5-day horizon, 1.7× fat-tail adjustment
            for equity kurtosis.
          </p>
        </div>
      )}
    </div>
  );
}
