import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { STOCKS } from "@/lib/config/stocks";

/// Social share card (og:image / twitter:image), generated at build time in
/// the landing page's broadsheet idiom — paper ground, serif display, mono
/// ticker — so a shared link looks like the product, not a generic banner.
/// Ticker prices are the static reference prices from lib/config/stocks; the
/// card is a snapshot, not a live surface.

export const alt =
  "EquiFlow — pledge tokenized US equities on Robinhood Chain and borrow regulated stablecoins without selling a share.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#FAF8F2";
const PAPER_ALT = "#F3EFE5";
const INK = "#1A1814";
const INK_SOFT = "#4A463E";
const INK_MUTE = "#6B6558";
const HAIRLINE = "#D9D2C2";
const AMBER = "#C9913B";

export default async function Image() {
  const [serif, serifItalic, mono] = await Promise.all([
    readFile(join(process.cwd(), "assets/og/source-serif-4-500.ttf")),
    readFile(join(process.cwd(), "assets/og/source-serif-4-500-italic.ttf")),
    readFile(join(process.cwd(), "assets/og/jetbrains-mono-500.ttf")),
  ]);

  const ticker = STOCKS.filter((s) => s.liveOnRBN).map((s) => ({
    sym: s.sym,
    price: s.price.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    }),
  }));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: PAPER,
          color: INK,
          padding: "44px 56px 0",
          fontFamily: "Source Serif 4",
        }}
      >
        {/* top rule + kicker row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `3px solid ${INK}`,
            paddingTop: 18,
            fontFamily: "JetBrains Mono",
            fontSize: 19,
            letterSpacing: "0.14em",
            color: INK_MUTE,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 11,
                height: 11,
                borderRadius: 999,
                background: AMBER,
                display: "flex",
              }}
            />
            <span>STOCK-COLLATERALIZED BORROWING</span>
          </div>
          <span>ROBINHOOD CHAIN · ARBITRUM ORBIT L3</span>
        </div>

        {/* headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            justifyContent: "center",
          }}
        >
          {/* Satori cannot reflow mixed normal/italic inline spans — author
              the headline as explicit lines instead. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 64,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
            }}
          >
            <div style={{ display: "flex" }}>
              <span>Your tokenized stocks</span>
            </div>
            <div style={{ display: "flex" }}>
              <span>shouldn&apos;t&nbsp;</span>
              <span style={{ fontStyle: "italic" }}>sit idle</span>
              <span>.</span>
            </div>
            <div style={{ display: "flex" }}>
              <span>Put them to work —</span>
            </div>
            <div style={{ display: "flex" }}>
              <span style={{ fontStyle: "italic" }}>without selling</span>
              <span>&nbsp;a share.</span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 26,
              lineHeight: 1.4,
              color: INK_SOFT,
            }}
          >
            Pledge TSLA or AMD, borrow regulated stablecoins. One signature ·
            sponsored gas · no taxable sale.
          </div>
        </div>

        {/* wordmark + domain row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            paddingBottom: 24,
          }}
        >
          <span style={{ fontSize: 40, letterSpacing: "-0.02em" }}>
            EquiFlow
          </span>
          <span
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 21,
              letterSpacing: "0.1em",
              color: INK_MUTE,
            }}
          >
            EQUIFLOW.XYZ · TESTNET
          </span>
        </div>

        {/* ticker band, full-bleed */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 26,
            margin: "0 -56px",
            padding: "18px 56px",
            background: PAPER_ALT,
            borderTop: `1px solid ${HAIRLINE}`,
            fontFamily: "JetBrains Mono",
            fontSize: 20,
          }}
        >
          {ticker.map((t) => (
            <div
              key={t.sym}
              style={{ display: "flex", alignItems: "baseline", gap: 12 }}
            >
              <span style={{ color: INK }}>{t.sym}</span>
              <span style={{ color: INK_SOFT }}>{t.price}</span>
              <span style={{ color: HAIRLINE }}>·</span>
            </div>
          ))}
          <span style={{ color: INK_MUTE, letterSpacing: "0.1em" }}>PYTH</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Source Serif 4", data: serif, weight: 500, style: "normal" },
        {
          name: "Source Serif 4",
          data: serifItalic,
          weight: 500,
          style: "italic",
        },
        { name: "JetBrains Mono", data: mono, weight: 500, style: "normal" },
      ],
    },
  );
}
