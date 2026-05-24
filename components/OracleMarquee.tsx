"use client";

import { STOCKS } from "@/lib/config/stocks";
import { fmt } from "@/lib/format";
import { useStockPrices } from "@/lib/hooks/use-adapter-price";

export function OracleMarquee() {
  const prices = useStockPrices();
  const items = [...STOCKS, ...STOCKS];
  return (
    <div className="border-b border-hairline-soft bg-paper-alt overflow-hidden relative h-8">
      <div
        className="flex gap-7 py-[7px] whitespace-nowrap"
        style={{
          width: "max-content",
          animation: "ef-marquee 60s linear infinite",
        }}
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
    </div>
  );
}
