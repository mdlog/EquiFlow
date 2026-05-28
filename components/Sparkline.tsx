type Props = {
  data?: number[];
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
  points?: number;
  /// Accessible label — typically `"${sym} 7-day trend"`. If omitted, the
  /// sparkline is treated as decorative and hidden from assistive tech.
  ariaLabel?: string;
};

export function Sparkline({
  data,
  w = 96,
  h = 24,
  color = "var(--ink)",
  fill = false,
  points = 48,
  ariaLabel,
}: Props) {
  const series = data && data.length >= 2 ? data : Array(points).fill(50);

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(1e-9, max - min);
  const normalized = series.map((v) => 10 + ((v - min) / span) * 80);

  const path = normalized
    .map((p, i) => {
      const x = (i / (normalized.length - 1)) * w;
      const y = h - (p / 100) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = path + ` L${w},${h} L0,${h} Z`;

  // Direction summary for screen readers — derived from first→last sample.
  const first = series[0] ?? 0;
  const last = series[series.length - 1] ?? 0;
  const direction = last > first ? "up" : last < first ? "down" : "flat";
  const summary = ariaLabel ?? "";

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="block"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel ? `${summary}, trend ${direction}` : undefined}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {ariaLabel && <title>{`${summary}, trend ${direction}`}</title>}
      {fill && <path d={area} fill={color} opacity="0.08" />}
      <path d={path} stroke={color} strokeWidth="1.2" fill="none" />
    </svg>
  );
}
