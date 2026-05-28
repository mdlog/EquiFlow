import Image from "next/image";

type Props = { size?: number; priority?: boolean };

export function Wordmark({ size = 16, priority = false }: Props) {
  return (
    <span className="flex items-center gap-0">
      <Logo size={size + 4} priority={priority} />
      <span
        className="font-serif font-medium tracking-tight"
        style={{ fontSize: size + 4, marginLeft: -1 }}
      >
        quiFlow
      </span>
    </span>
  );
}

export function Logo({ size = 16, priority = false }: Props) {
  // Using next/image with priority on the topbar logo (LCP candidate) and a
  // bounded width/height. The PNG in /public is 200KB raw — Next image
  // optimiser serves an AVIF/WebP at the actual render size.
  return (
    <Image
      src="/logo-equiflow.png"
      alt=""
      width={size}
      height={size}
      priority={priority}
      className="block"
      style={{ height: size, width: "auto" }}
    />
  );
}
