"use client";

import { useState } from "react";
import { STOCKS } from "@/lib/config/stocks";
import { fmt } from "@/lib/format";
import { useStockPrices } from "@/lib/hooks/use-adapter-price";

export function OracleMarquee() {
  const prices = useStockPrices();
  const items = [...STOCKS, ...STOCKS];
  const [paused, setPaused] = useState(false);

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
          const up = (live?.price ?? s.price) >= s.price;
          return (
            <span
              key={i}
              className="inline-flex items-center gap-2"
              style={{ fontSize: 12 }}
            >
              <span className="font-mono font-medium">{s.sym}</span>
              <span className="font-mono tabular text-ink-soft">
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
                style={{ color: up ? "var(--up)" : "var(--down)" }}
              >
                {live?.price
                  ? fmt.pct((live.price - s.price) / s.price, 2, true)
                  : "—"}
              </span>
              <span className="text-hairline">·</span>
            </span>
          );
        })}
      </div>

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
