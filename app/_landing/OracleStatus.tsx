"use client";

import { useEquitySession } from "@/lib/hooks/use-equity-session";

/// Live oracle line for the hero proof strip: session state + last push age,
/// replacing the static "24/5 multi-session" claim with the page proving it.
/// Falls back to the static wording while nothing has resolved yet (SSR and
/// first client render are identical — no hydration mismatch).
export function OracleStatus() {
  const { open, freshnessSec } = useEquitySession();

  if (open == null) return <>Pyth Network · 24/5 multi-session</>;

  const fresh =
    freshnessSec == null
      ? null
      : freshnessSec < 120
        ? `${freshnessSec}s ago`
        : freshnessSec < 120 * 60
          ? `${Math.floor(freshnessSec / 60)}m ago`
          : `${Math.floor(freshnessSec / 3600)}h ago`;

  return (
    <>
      {`Pyth · market ${open ? "open" : "closed"}${fresh ? ` · updated ${fresh}` : ""}`}
    </>
  );
}
