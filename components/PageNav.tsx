"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./Wordmark";
import { WalletButton } from "./WalletButton";

const PAGES = [
  { id: "markets", label: "Markets", href: "/markets" },
  { id: "topography", label: "Topography", href: "/topography" },
  { id: "pledge", label: "Pledge", href: "/pledge" },
  { id: "positions", label: "Positions", href: "/positions" },
  { id: "liquidations", label: "Liquidations", href: "/liquidations" },
] as const;

type Props = {
  current?: (typeof PAGES)[number]["id"];
  rightExtras?: React.ReactNode;
};

export function PageNav({ current, rightExtras }: Props) {
  const pathname = usePathname();
  const active = current ?? PAGES.find((p) => pathname?.startsWith(p.href))?.id;

  return (
    <header className="border-b border-hairline bg-paper shrink-0">
      <div
        className="max-w-[1320px] mx-auto px-8 py-3.5 grid items-center"
        style={{ gridTemplateColumns: "1fr auto 1fr" }}
      >
        <Link href="/" className="flex no-underline text-ink justify-self-start">
          <Wordmark size={16} />
        </Link>
        <nav className="flex gap-[22px] text-[13px] justify-self-center">
          {PAGES.map((p) => {
            const isActive = p.id === active;
            return (
              <Link
                key={p.id}
                href={p.href}
                className="no-underline pb-4 -mb-4 transition-colors"
                style={{
                  color: isActive ? "var(--ink)" : "var(--ink-soft)",
                  fontWeight: isActive ? 500 : 400,
                  borderBottom: isActive
                    ? "1.5px solid var(--ink)"
                    : "1.5px solid transparent",
                }}
              >
                {p.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 justify-self-end">
          {rightExtras}
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
