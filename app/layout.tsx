import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SITE_URL } from "@/lib/site";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  // Mono is only used in numeric/data cells — defer until needed.
  preload: false,
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:
      "EquiFlow · Stock-Collateralized Borrowing · Robinhood Chain",
    template: "%s · EquiFlow",
  },
  description:
    "Pledge tokenized US equities as collateral on Robinhood Chain (Arbitrum Orbit L3) and borrow regulated stablecoins. One signature, sponsored gas, no taxable sale.",
  applicationName: "EquiFlow",
  authors: [{ name: "EquiFlow" }],
  openGraph: {
    type: "website",
    siteName: "EquiFlow",
    title: "EquiFlow — Stock-collateralized borrowing on Robinhood Chain",
    description:
      "Pledge tokenized US equities and borrow USDG against them. One signature, sponsored gas, no taxable sale.",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "EquiFlow — Stock-collateralized borrowing on Robinhood Chain",
    description:
      "Pledge tokenized US equities and borrow USDG against them. One signature, sponsored gas, no taxable sale.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${jetbrainsMono.variable} ${sourceSerif.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-paper text-ink">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
