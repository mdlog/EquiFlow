"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Wordmark";
import { ChainTicker } from "@/components/ChainTicker";
import { WalletButton } from "@/components/WalletButton";

const NAV_LINKS = [
  { label: "Markets", href: "/markets" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Docs", href: "#", muted: true },
  { label: "Audits", href: "#", muted: true },
];

export function TopNav() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      className="sticky top-0 z-50 border-b border-hairline"
      style={{
        background: "rgba(250, 248, 242, 0.92)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8 flex items-center justify-between h-14">
        <Link href="/" className="flex items-center gap-0 no-underline text-ink">
          <Logo size={22} />
          <span
            className="font-serif font-medium"
            style={{ fontSize: 19, letterSpacing: "-0.02em", marginLeft: -1 }}
          >
            quiFlow
          </span>
          <span
            className="font-mono text-ink-mute border-l border-hairline pl-2.5 ml-1 hidden sm:inline"
            style={{ fontSize: 10, letterSpacing: "0.08em" }}
          >
            PROTOCOL · TESTNET
          </span>
        </Link>

        <nav className="hidden md:flex gap-7 text-[13px]">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="no-underline py-[18px] transition-colors hover:text-ink"
              style={{ color: l.muted ? "var(--ink-mute)" : "var(--ink-soft)" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:inline-flex"><ChainTicker /></span>
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
        <nav className="md:hidden border-t border-hairline bg-paper px-4 py-3 flex flex-col gap-0.5">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="no-underline py-2.5 px-2 rounded-[2px] transition-colors hover:bg-paper-alt"
              style={{ fontSize: 14, color: l.muted ? "var(--ink-mute)" : "var(--ink-soft)" }}
            >
              {l.label}
            </Link>
          ))}
          <div className="pt-2 mt-1 border-t border-hairline-soft sm:hidden">
            <ChainTicker />
          </div>
        </nav>
      )}

      <style>{btnStyles}</style>
    </header>
  );
}

const btnStyles = `
.btn-primary, .btn-ghost {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 14px; border-radius: 2px;
  font-size: 13px; font-weight: 500;
  text-decoration: none; cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
  border: 1px solid transparent;
}
.btn-sm { padding: 7px 11px; font-size: 12px; }
.btn-primary { background: var(--ink); color: var(--paper); }
.btn-primary:hover { background: #0f0e0c; }
.btn-ghost { background: transparent; color: var(--ink); border-color: var(--ink); }
.btn-ghost:hover { background: var(--ink); color: var(--paper); }
.btn-on-dark-primary { background: var(--paper); color: var(--ink); border-color: var(--paper); }
.btn-on-dark-primary:hover { background: rgba(250,248,242,.85); }
.btn-on-dark-ghost { background: transparent; color: var(--paper); border-color: rgba(250,248,242,.3); }
.btn-on-dark-ghost:hover { background: rgba(250,248,242,.1); color: var(--paper); }
`;
