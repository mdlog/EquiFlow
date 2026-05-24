"use client";

import { useState } from "react";

/// Banner that surfaces stale-oracle state to the user and lets them trigger
/// a keeper sweep manually. Without this, the user just sees Repay/Withdraw
/// buttons silently disabled (positionOf() reverts → use-position.ts returns
/// zeros → modals refuse to enable). The CTA hits /api/keeper/cron which
/// loops over every listed asset and pushes a fresh Pyth quote.
///
/// Render this anywhere `usePosition().oracleStale === true`.
interface Props {
  /** Optional className for outer container — defaults to a full-width strip. */
  className?: string;
}

type Status = "idle" | "refreshing" | "success" | "error";

export function StaleOracleBanner({ className }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState<string | null>(null);

  async function refresh() {
    setStatus("refreshing");
    setDetail(null);
    try {
      const res = await fetch("/api/keeper/cron", { cache: "no-store" });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        summary?: { ticked: number; failed: number; total: number };
      };
      if (!data.ok) {
        setStatus("error");
        setDetail(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const s = data.summary;
      setStatus("success");
      setDetail(
        s ? `Ticked ${s.ticked}/${s.total} adapters` : "Keeper sweep complete",
      );
      // Position hook will pick up fresh state on next 12s refetch — but nudge
      // sooner so the user doesn't stare at a stale banner.
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err) {
      setStatus("error");
      setDetail(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      className={
        className ??
        "border-b border-hairline px-8 py-3 flex items-center gap-4 justify-between"
      }
      style={{
        background: "color-mix(in srgb, var(--amber) 12%, var(--paper))",
        borderTop: "1px solid var(--amber)",
        borderBottom: "1px solid var(--amber)",
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--amber)",
            boxShadow: "0 0 0 3px color-mix(in srgb, var(--amber) 25%, transparent)",
          }}
        />
        <div>
          <div
            className="font-mono uppercase"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            Oracle prices stale
          </div>
          <div className="text-ink-soft" style={{ fontSize: 12 }}>
            Position values and the Repay / Withdraw actions are paused until
            the keeper pushes a fresh Pyth quote.
          </div>
          {detail && (
            <div
              className="font-mono text-ink-mute mt-1"
              style={{
                fontSize: 10,
                color: status === "error" ? "var(--down)" : "var(--up)",
              }}
            >
              {status === "error" ? "✗ " : "✓ "}
              {detail}
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={refresh}
        disabled={status === "refreshing"}
        className="font-mono uppercase rounded-[2px] no-underline"
        style={{
          fontSize: 11,
          letterSpacing: "0.06em",
          padding: "8px 14px",
          background: "var(--ink)",
          color: "var(--paper)",
          border: "1px solid var(--ink)",
          opacity: status === "refreshing" ? 0.6 : 1,
          cursor: status === "refreshing" ? "wait" : "pointer",
        }}
      >
        {status === "refreshing" ? "Refreshing…" : "Refresh oracle"}
      </button>
    </div>
  );
}
