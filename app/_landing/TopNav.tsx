import Link from "next/link";
import { Logo } from "@/components/Wordmark";
import { ChainTicker } from "@/components/ChainTicker";
import { WalletButton } from "@/components/WalletButton";

const NAV_LINKS = [
  { label: "Markets", href: "/markets" },
  { label: "Topography", href: "/topography" },
  { label: "Pledge", href: "/pledge" },
  { label: "Positions", href: "/positions" },
  { label: "Docs", href: "#", muted: true },
  { label: "Audits", href: "#", muted: true },
];

/// Sticky top bar with logo, primary nav, chain status, wallet button.
/// `btnStyles` is injected inline because the rest of the landing reuses these
/// utility classes (.btn-primary, .btn-ghost, .btn-on-dark-*) — keeping them
/// here means every page that mounts TopNav also gets the styles.
export function TopNav() {
  return (
    <header
      className="sticky top-0 z-50 border-b border-hairline"
      style={{
        background: "rgba(250, 248, 242, 0.92)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="max-w-[1320px] mx-auto px-8 flex items-center justify-between h-14">
        <Link href="/" className="flex items-center gap-0 no-underline text-ink">
          <Logo size={22} />
          <span
            className="font-serif font-medium"
            style={{ fontSize: 19, letterSpacing: "-0.02em", marginLeft: -1 }}
          >
            quiFlow
          </span>
          <span
            className="font-mono text-ink-mute border-l border-hairline pl-2.5 ml-1"
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

        <div className="flex items-center gap-3">
          <ChainTicker />
          <WalletButton />
        </div>
      </div>

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
