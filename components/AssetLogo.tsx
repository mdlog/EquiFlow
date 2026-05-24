"use client";

import { useState } from "react";

const DOMAINS: Record<string, string> = {
  AAPL: "apple.com",
  TSLA: "tesla.com",
  AMZN: "amazon.com",
  PLTR: "palantir.com",
  NFLX: "netflix.com",
  AMD: "amd.com",
  NVDA: "nvidia.com",
  MSFT: "microsoft.com",
  GOOGL: "abc.xyz",
  GOOG: "abc.xyz",
  META: "meta.com",
  SPY: "ssga.com",
  QQQ: "invesco.com",
};

export const assetDomain = (sym: string): string | undefined => DOMAINS[sym];

export function AssetLogo({
  sym,
  size = 24,
  className,
  style,
  rounded = false,
}: {
  sym: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  rounded?: boolean;
}) {
  const [errored, setErrored] = useState(false);
  const domain = DOMAINS[sym];
  const src = domain
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
    : null;

  if (!src || errored) {
    return (
      <span
        className={`font-serif font-semibold tracking-tighter ${className ?? ""}`}
        style={{ fontSize: Math.max(9, Math.round(size * 0.42)), ...style }}
      >
        {sym.slice(0, 3)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={sym}
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: rounded ? "cover" : "contain",
        display: "block",
        borderRadius: rounded ? "9999px" : undefined,
        background: rounded ? "var(--paper)" : undefined,
        ...style,
      }}
      onError={() => setErrored(true)}
    />
  );
}
