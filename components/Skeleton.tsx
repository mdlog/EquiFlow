/// Shimmer skeleton placeholder. Pure CSS — no animation library, no JS.
/// Pass width/height inline; rounding follows --radius-xs by default.

type Props = {
  width?: number | string;
  height?: number | string;
  className?: string;
  radius?: number | string;
  /// Match the line-height of the text being replaced so layout doesn't shift
  /// when the real content swaps in.
  inline?: boolean;
};

export function Skeleton({
  width = "100%",
  height = 14,
  className = "",
  radius = "var(--radius-xs)",
  inline = false,
}: Props) {
  return (
    <span
      className={className}
      role="presentation"
      aria-hidden="true"
      style={{
        display: inline ? "inline-block" : "block",
        width,
        height,
        borderRadius: radius,
        background:
          "linear-gradient(90deg, var(--paper-alt) 0%, var(--paper-deep) 50%, var(--paper-alt) 100%)",
        backgroundSize: "200% 100%",
        animation: "ef-shimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}
