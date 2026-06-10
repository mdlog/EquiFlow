"use client";

import { useEffect, useState } from "react";

/// Compact stat tile rendering "Auto-defenders active: N". Polls
/// /api/defender/count every 30s. Renders inside the landing-page StatBand
/// next to the other 4 hardcoded stats so the grid stays 5-wide.

export function AutoDefenderStat({ index = 4 }: { index?: number }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await fetch("/api/defender/count", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (!cancelled && typeof data.count === "number") {
          setCount(data.count);
        }
      } catch {
        // silent fallback — keep showing 0
      }
    };
    fetchCount();
    const id = setInterval(fetchCount, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const display = count;

  return (
    <div
      className="relative"
      style={{
        padding: "0 24px",
        borderLeft: index > 0 ? "1px solid var(--hairline)" : "none",
      }}
    >
      <div
        className="font-medium text-ink-mute uppercase"
        style={{ fontSize: 10, letterSpacing: "0.14em", marginBottom: 10 }}
      >
        Auto-defenders
      </div>
      <div
        className="font-serif font-medium tabular"
        style={{ fontSize: 36, letterSpacing: "-0.03em", lineHeight: 1 }}
      >
        {display != null ? display.toLocaleString("en-US") : "—"}
      </div>
      <div
        className="font-mono text-ink-mute mt-2 inline-flex items-center gap-1.5"
        style={{ fontSize: 11 }}
      >
        <span
          className="inline-block rounded-full"
          style={{
            width: 6,
            height: 6,
            background: display != null && display > 0 ? "var(--up)" : "var(--ink-mute)",
          }}
        />
        <span>
          {display == null
            ? "loading"
            : display > 0
              ? "dry-run · BETA"
              : "BETA · awaiting first keeper"}
        </span>
      </div>
    </div>
  );
}
