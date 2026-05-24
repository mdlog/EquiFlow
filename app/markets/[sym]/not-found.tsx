import Link from "next/link";
import { PageNav } from "@/components/PageNav";
import { SiteFooter } from "@/components/SiteFooter";
import { STOCKS } from "@/lib/config/stocks";

export default function AssetNotFound() {
  return (
    <div className="flex flex-col min-h-screen">
      <PageNav current="markets" />
      <main className="flex-1 max-w-[1320px] w-full mx-auto px-8 py-20 text-center">
        <div
          className="eyebrow mb-3"
          style={{ color: "var(--down)" }}
        >
          404 · Unknown asset
        </div>
        <h1
          className="font-serif font-medium"
          style={{ fontSize: 52, letterSpacing: "-0.03em", lineHeight: 1.05 }}
        >
          We do not have a feed for this ticker.
        </h1>
        <p
          className="text-ink-soft mx-auto mt-4 mb-8"
          style={{ fontSize: 16, maxWidth: 540, lineHeight: 1.5 }}
        >
          EquiFlow only lists equities with an active Pyth Network price feed and a
          configured Robinhood Chain token. Pick one from the markets table to
          continue.
        </p>

        <Link
          href="/markets"
          className="inline-flex items-center gap-2 bg-ink text-paper no-underline rounded-[2px] px-5 py-3 font-medium"
          style={{ fontSize: 14 }}
        >
          Back to markets
        </Link>

        <div className="mt-12 max-w-[640px] mx-auto">
          <div className="eyebrow mb-3 text-left">Try one of these</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STOCKS.slice(0, 8).map((s) => (
              <Link
                key={s.sym}
                href={`/markets/${s.sym}`}
                className="font-mono no-underline border border-hairline rounded-[2px] py-2.5 hover:border-ink transition-colors text-ink"
                style={{ fontSize: 13, letterSpacing: "0.04em" }}
              >
                {s.sym}
              </Link>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
