"use client";

import { useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-hairline bg-paper shrink-0">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <Link href="/" className="flex no-underline text-ink shrink-0">
          <Wordmark size={16} />
        </Link>
        <nav className="hidden md:flex gap-[22px] text-[13px]">
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
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:inline-flex">{rightExtras}</span>
          <WalletButton />
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="md:hidden flex flex-col justify-center items-center w-9 h-9 border border-hairline rounded-[2px] bg-transparent"
            aria-label="Toggle menu"
          >
            <span className="block w-4 h-[1.5px] bg-ink transition-transform" style={{
              transform: menuOpen ? "translateY(2.75px) rotate(45deg)" : "none",
            }} />
            <span className="block w-4 h-[1.5px] bg-ink mt-[4px] transition-opacity" style={{
              opacity: menuOpen ? 0 : 1,
            }} />
            <span className="block w-4 h-[1.5px] bg-ink mt-[4px] transition-transform" style={{
              transform: menuOpen ? "translateY(-6.25px) rotate(-45deg)" : "none",
            }} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="md:hidden border-t border-hairline bg-paper px-4 py-2 flex flex-col gap-0.5">
          {PAGES.map((p) => {
            const isActive = p.id === active;
            return (
              <Link
                key={p.id}
                href={p.href}
                onClick={() => setMenuOpen(false)}
                className="no-underline py-2.5 px-2 rounded-[2px] transition-colors hover:bg-paper-alt"
                style={{
                  fontSize: 14,
                  color: isActive ? "var(--ink)" : "var(--ink-soft)",
                  fontWeight: isActive ? 500 : 400,
                  background: isActive ? "var(--paper-alt)" : undefined,
                }}
              >
                {p.label}
              </Link>
            );
          })}
          {rightExtras && (
            <div className="pt-2 mt-1 border-t border-hairline-soft sm:hidden">
              {rightExtras}
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
