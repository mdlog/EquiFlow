type Props = {
  color?: string;
  size?: number;
  label?: string | null;
};

export function OraclePing({
  color = "var(--up)",
  size = 6,
  label = "Pyth · live",
}: Props) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="relative inline-flex"
        style={{ width: size, height: size }}
      >
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: color,
            animation: "ef-pulse 1.8s cubic-bezier(0,0,.2,1) infinite",
          }}
        />
        <span
          className="relative rounded-full"
          style={{ width: size, height: size, background: color }}
        />
      </span>
      {label && (
        <span
          className="font-mono text-ink-mute"
          style={{ fontSize: 10, letterSpacing: "0.04em" }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
