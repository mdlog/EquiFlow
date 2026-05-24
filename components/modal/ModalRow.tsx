"use client";

interface Props {
  k: string;
  v: string;
  color?: string;
}

/// Plain key/value row used in modal summary blocks. Lowercase key, mono value.
export function SumRow({ k, v, color }: Props) {
  return (
    <div
      className="flex justify-between items-baseline"
      style={{ padding: "5px 0", fontSize: 12 }}
    >
      <span className="text-ink-mute">{k}</span>
      <span
        className="font-mono tabular font-medium"
        style={{ color: color ?? "var(--ink)" }}
      >
        {v}
      </span>
    </div>
  );
}

/// Same row, but with an UPPERCASE eyebrow-style key. Used for "after action"
/// preview blocks (post-borrow LTV, post-repay health factor, etc.).
export function PreviewRow({ k, v, color }: Props) {
  return (
    <div
      className="flex justify-between items-baseline"
      style={{ padding: "5px 0", fontSize: 12 }}
    >
      <span
        className="font-mono text-ink-mute uppercase"
        style={{ fontSize: 10, letterSpacing: "0.04em" }}
      >
        {k}
      </span>
      <span
        className="font-mono tabular font-medium"
        style={{ color: color ?? "var(--ink)" }}
      >
        {v}
      </span>
    </div>
  );
}
