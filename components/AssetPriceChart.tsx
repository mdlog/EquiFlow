"use client";

import { useMemo, useState } from "react";
import { useAssetHistory, type Resolution } from "@/lib/hooks/use-asset-history";
import { fmt } from "@/lib/format";

/// Full-width price chart for the asset detail page. Reads real OHLCV bars
/// from Pyth Benchmarks via /api/markets/history/[sym].
///
/// Three timeframes:
///   1D  → 5-min bars over the last 24h (288 bars max)
///   7D  → 60-min bars over the last 7d  (168 bars)
///   30D → daily bars over the last 30d
///
/// Renders an area + line SVG matching the existing paper/ink design language.
/// On chart hover we surface the bar's close + timestamp; outside of hover the
/// header shows the most-recent bar instead.

type Tf = "1D" | "7D" | "30D";

const TIMEFRAMES: Record<Tf, { days: number; resolution: Resolution; label: string }> = {
  "1D": { days: 1, resolution: "5", label: "24 HOURS" },
  "7D": { days: 7, resolution: "60", label: "7 DAYS" },
  "30D": { days: 30, resolution: "D", label: "30 DAYS" },
};

const W = 920;
const H = 240;
const PAD_T = 16;
const PAD_B = 28;
const PAD_L = 0;
const PAD_R = 12;

interface Props {
  symbol: string;
  fallbackPrice?: number;
}

export function AssetPriceChart({ symbol, fallbackPrice }: Props) {
  const [tf, setTf] = useState<Tf>("7D");
  const { days, resolution, label } = TIMEFRAMES[tf];
  const { data, isLoading } = useAssetHistory({ symbol, days, resolution });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const series = useMemo(() => {
    const t = data?.t ?? [];
    const c = data?.c ?? [];
    const h = data?.h ?? [];
    const l = data?.l ?? [];
    if (t.length < 2 || c.length !== t.length) return null;
    const min = Math.min(...l);
    const max = Math.max(...h);
    const span = Math.max(1e-6, max - min);
    return { t, c, h, l, min, max, span };
  }, [data]);

  const lastIdx = series ? series.t.length - 1 : -1;
  const displayIdx = hoverIdx ?? lastIdx;
  const displayClose =
    series && displayIdx >= 0 ? series.c[displayIdx] : fallbackPrice ?? null;
  const displayTime =
    series && displayIdx >= 0 ? series.t[displayIdx] : null;

  const firstClose = series ? series.c[0] : null;
  const lastClose = series ? series.c[lastIdx] : null;
  const totalChange =
    firstClose != null && lastClose != null && firstClose > 0
      ? ((lastClose - firstClose) / firstClose) * 100
      : null;
  const up = (totalChange ?? 0) >= 0;
  const color = up ? "var(--up)" : "var(--down)";

  /// Build the area/line paths in SVG user units once per series.
  const paths = useMemo(() => {
    if (!series) return null;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    const x = (i: number) =>
      PAD_L + (i / (series.t.length - 1)) * innerW;
    const y = (v: number) =>
      PAD_T + innerH - ((v - series.min) / series.span) * innerH;
    const points = series.c.map((v, i) => [x(i), y(v)] as const);
    const line = points
      .map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px.toFixed(1)},${py.toFixed(1)}`)
      .join(" ");
    const area =
      line +
      ` L ${points[points.length - 1][0].toFixed(1)},${H - PAD_B}` +
      ` L ${points[0][0].toFixed(1)},${H - PAD_B} Z`;
    return { line, area, x, y };
  }, [series]);

  /// Mouse-x → nearest bar index. Bars are evenly spaced so plain proportion
  /// is exact; keep clamped so off-edge hovers map to first/last instead of
  /// disappearing.
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!series) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const innerW = W - PAD_L - PAD_R;
    const ratio = Math.max(0, Math.min(1, (px - PAD_L) / innerW));
    setHoverIdx(Math.round(ratio * (series.t.length - 1)));
  }

  return (
    <div className="border-y border-hairline bg-paper">
      <div className="max-w-[1320px] mx-auto px-8 py-6">
        {/* Header — timeframe toggle + last/hover bar readout */}
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="eyebrow mb-1">Price · {label} · Pyth Benchmarks</div>
            <div className="flex items-baseline gap-3">
              <div
                className="font-serif font-medium tabular"
                style={{ fontSize: 38, letterSpacing: "-0.03em", lineHeight: 1 }}
              >
                {displayClose != null ? fmt.usd(displayClose) : "—"}
              </div>
              {totalChange != null && (
                <div
                  className="font-mono tabular font-medium"
                  style={{ fontSize: 14, color }}
                >
                  {fmt.pct(totalChange, 2, true)}{" "}
                  <span className="text-ink-mute" style={{ fontWeight: 400 }}>
                    · {tf.toLowerCase()}
                  </span>
                </div>
              )}
            </div>
            {displayTime != null && (
              <div className="text-ink-mute font-mono mt-1" style={{ fontSize: 11 }}>
                {hoverIdx != null ? "at " : "last bar · "}
                {new Date(displayTime * 1000).toLocaleString()}
              </div>
            )}
          </div>

          <div className="flex gap-1 p-[3px] border border-hairline rounded-[2px]">
            {(Object.keys(TIMEFRAMES) as Tf[]).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setTf(k);
                  setHoverIdx(null);
                }}
                className="border-0 px-3 py-1.5 rounded-[2px] transition-colors font-mono"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.04em",
                  background: tf === k ? "var(--ink)" : "transparent",
                  color: tf === k ? "var(--paper)" : "var(--ink-soft)",
                }}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        {/* Chart body */}
        <div className="relative">
          {isLoading && !series && (
            <div
              className="text-ink-mute font-mono absolute inset-0 flex items-center justify-center"
              style={{ fontSize: 11 }}
            >
              Loading bars from Pyth Benchmarks…
            </div>
          )}
          {!isLoading && !series && (
            <div
              className="text-ink-mute font-mono absolute inset-0 flex items-center justify-center"
              style={{ fontSize: 11 }}
            >
              Pyth Benchmarks has no bars for this window — try a wider timeframe.
            </div>
          )}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            className="block"
            style={{ minHeight: 240 }}
            onMouseMove={onMove}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Background gridlines (horizontal halves/quarters) */}
            {series && (
              <g>
                {[0.25, 0.5, 0.75].map((p) => {
                  const yPx = PAD_T + (H - PAD_T - PAD_B) * p;
                  return (
                    <line
                      key={p}
                      x1={PAD_L}
                      x2={W - PAD_R}
                      y1={yPx}
                      y2={yPx}
                      stroke="var(--hairline-soft)"
                      strokeWidth="0.5"
                      strokeDasharray="2 4"
                    />
                  );
                })}
              </g>
            )}

            {paths && (
              <>
                <path d={paths.area} fill={color} opacity="0.08" />
                <path d={paths.line} stroke={color} strokeWidth="1.4" fill="none" />
              </>
            )}

            {/* Crosshair */}
            {series && hoverIdx != null && paths && (
              <g>
                <line
                  x1={paths.x(hoverIdx)}
                  x2={paths.x(hoverIdx)}
                  y1={PAD_T}
                  y2={H - PAD_B}
                  stroke="var(--ink)"
                  strokeWidth="0.6"
                  strokeDasharray="2 3"
                  opacity="0.4"
                />
                <circle
                  cx={paths.x(hoverIdx)}
                  cy={paths.y(series.c[hoverIdx])}
                  r="3"
                  fill={color}
                />
              </g>
            )}

            {/* Min/max labels at the right axis */}
            {series && (
              <g
                className="font-mono"
                fontSize="9"
                fill="var(--ink-mute)"
                style={{ letterSpacing: "0.04em" }}
              >
                <text x={W - PAD_R - 2} y={PAD_T + 4} textAnchor="end">
                  {fmt.usd(series.max)}
                </text>
                <text x={W - PAD_R - 2} y={H - PAD_B - 2} textAnchor="end">
                  {fmt.usd(series.min)}
                </text>
              </g>
            )}

            {/* X-axis time labels: first / middle / last */}
            {series && (
              <g
                className="font-mono"
                fontSize="9"
                fill="var(--ink-mute)"
                style={{ letterSpacing: "0.04em" }}
              >
                <text x={PAD_L + 4} y={H - 8}>
                  {formatTick(series.t[0], tf)}
                </text>
                <text x={W / 2} y={H - 8} textAnchor="middle">
                  {formatTick(series.t[Math.floor(series.t.length / 2)], tf)}
                </text>
                <text x={W - PAD_R - 4} y={H - 8} textAnchor="end">
                  {formatTick(series.t[series.t.length - 1], tf)}
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

function formatTick(ts: number, tf: Tf): string {
  const d = new Date(ts * 1000);
  if (tf === "1D") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (tf === "7D") {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
