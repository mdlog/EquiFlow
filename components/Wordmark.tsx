type Props = { size?: number };

export function Wordmark({ size = 16 }: Props) {
  return (
    <span className="flex items-center gap-0">
      <Logo size={size + 4} />
      <span
        className="font-serif font-medium tracking-tight"
        style={{ fontSize: size + 4, marginLeft: -1 }}
      >
        quiFlow
      </span>
    </span>
  );
}

export function Logo({ size = 16 }: Props) {
  return (
    <img
      src="/logo-equiflow.png"
      alt="EquiFlow"
      height={size}
      className="block"
      style={{ height: size, width: "auto" }}
    />
  );
}
