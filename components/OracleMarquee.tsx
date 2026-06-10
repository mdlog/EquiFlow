"use client";

import { useEffect, useRef, useState } from "react";
import { STOCKS } from "@/lib/config/stocks";
import { fmt } from "@/lib/format";
import { useStockPrices } from "@/lib/hooks/use-adapter-price";
import { useMarkets24h } from "@/lib/hooks/use-market-history";
import { useEquitySession } from "@/lib/hooks/use-equity-session";

// Module scope so the react-query key stays stable — identical to the
// SupportedAssets call, so both surfaces share one request.
const SYMS = STOCKS.map((s) => s.sym);

export function OracleMarquee() {
  const prices = useStockPrices();
  // Real 24h change, same source as the assets table — not drift vs the
  // hardcoded seed price, which contradicted the table on the same page.
  const h24 = useMarkets24h(SYMS);
  const session = useEquitySession();
  const items = [...STOCKS, ...STOCKS];
  const [paused, setPaused] = useState(false);

  // One prev-price map for the whole strip (items are STOCKS doubled, so a
  // per-item tick hook would double the work). dir drives the tick-up/down
  // background flash on the price spans, keyed to retrigger per change.
  const prevRef = useRef<Record<string, number>>({});
  const [dirs, setDirs] = useState<Record<string, -1 | 0 | 1>>({});
  useEffect(() => {
    const next: Record<string, -1 | 0 | 1> = {};
    let changed = false;
    for (const s of STOCKS) {
      const p = prices[s.sym]?.price;
      if (p == null) continue;
      const prev = prevRef.current[s.sym];
      if (prev != null) {
        if (p > prev + 0.0001) {
          next[s.sym] = 1;
          changed = true;
        } else if (p < prev - 0.0001) {
          next[s.sym] = -1;
          changed = true;
        }
      }
      prevRef.current[s.sym] = p;
    }
    if (changed) setDirs((d) => ({ ...d, ...next }));
  }, [prices]);

  return (
    <div
      className="border-b border-hairline-soft bg-paper-alt overflow-hidden relative h-8"
      // Container is decorative motion; SR users get the SR-only snapshot below.
      aria-label="Live oracle price ticker"
    >
      <div
        className="flex gap-7 py-[7px] whitespace-nowrap"
        style={{
          width: "max-content",
          animation: "ef-marquee 60s linear infinite",
          animationPlayState: paused ? "paused" : "running",
        }}
        aria-hidden="true"
      >
        {items.map((s, i) => {
          const live = prices[s.sym];
          const displayPrice = live?.price ?? s.price;
          const changePct = h24.data?.[s.sym]?.changePct ?? null;
          const dir = dirs[s.sym] ?? 0;
          return (
            <span
              key={i}
              className="inline-flex items-center gap-2"
              style={{ fontSize: 12 }}
            >
              <span className="font-mono font-medium">{s.sym}</span>
              <span
                key={`${dir}-${displayPrice.toFixed(2)}`}
                className={`font-mono tabular text-ink-soft inline-block px-1 rounded-[2px] ${
                  dir > 0
                    ? "animate-tick-up"
                    : dir < 0
                      ? "animate-tick-down"
                      : ""
                }`}
              >
                {fmt.usd(displayPrice)}
              </span>
              {live?.isLive ? (
                <span
                  className="font-mono"
                  style={{ fontSize: 9, color: "var(--up)" }}
                  title={`Pyth Network · last update ${live.updatedAt > 0 ? new Date(live.updatedAt * 1000).toLocaleTimeString() : "—"}`}
                >
                  ●
                </span>
              ) : null}
              <span
                className="font-mono tabular"
                style={{
                  color:
                    changePct == null
                      ? "var(--ink-mute)"
                      : changePct >= 0
                        ? "var(--up)"
                        : "var(--down)",
                }}
              >
                {changePct != null ? fmt.signedPct(changePct, 2) : "—"}
              </span>
              <span className="text-hairline">·</span>
            </span>
          );
        })}
      </div>

      {/* Fixed session chip — the protocol gates borrows by US market hours
          (vault `marketStatus`), so the page says so instead of letting a
          weekend price freeze read as a broken feed. Hidden while unknown. */}
      {session.open != null && (
        <span
          className="absolute left-0 top-0 h-full inline-flex items-center gap-1.5 bg-paper-alt font-mono text-ink-mute uppercase"
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            padding: "0 10px",
            borderRight: "1px solid var(--hairline)",
          }}
          title={
            session.open
              ? "US equity session open — Pyth prices streaming"
              : "Prices as of last session — borrows settle during US market sessions; deposits anytime"
          }
        >
          <span
            className="rounded-full inline-block"
            style={{
              width: 6,
              height: 6,
              background: session.open ? "var(--up)" : "var(--amber)",
              animation: session.open
                ? "ef-breathe 2.2s ease-in-out infinite"
                : undefined,
            }}
          />
          {session.open ? "US equities · open" : "US equities · closed"}
        </span>
      )}

      {/* Pause control — keyboard accessible, WCAG SC 2.2.2. */}
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="absolute top-0 right-2 h-full font-mono text-ink-mute hover:text-ink"
        style={{ fontSize: 10, padding: "0 6px" }}
        aria-label={paused ? "Resume ticker" : "Pause ticker"}
        aria-pressed={paused}
      >
        {paused ? "▶" : "⏸"}
      </button>

      {/* SR-only static snapshot. No live region — too chatty for ambient feed. */}
      <ul className="sr-only">
        {STOCKS.map((s) => {
          const live = prices[s.sym];
          const price = live?.price ?? s.price;
          return (
            <li key={s.sym}>
              {s.sym}: {fmt.usd(price)}
              {live?.isLive ? " (live)" : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
