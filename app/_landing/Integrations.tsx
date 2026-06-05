const cells = [
  {
    name: "Pyth Network",
    role: "Price Oracles · 24/5 sessions",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v18M3 12h18M5 5l14 14M5 19L19 5" />
      </svg>
    ),
  },
  {
    name: "EquiFlow Vault",
    role: "LP Yield · Borrow Spread",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <path d="M3 10h18M8 14h2M14 14h2" />
      </svg>
    ),
  },
  {
    name: "Alchemy AA",
    role: "Bundler · Gas Manager · ERC-4337",
    icon: (
      <svg viewBox="0 0 28 24" width="28" height="24" fill="currentColor">
        <path d="M2 6h4v12H2zM8 6h6v12H8zM16 12c0-3 2-6 6-6v3c-2 0-3 1-3 3s1 3 3 3v3c-4 0-6-3-6-6Z" />
      </svg>
    ),
  },
  {
    name: "Arbitrum",
    role: "Settlement Layer",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    ),
  },
  {
    name: "OpenZeppelin",
    role: "Smart-contract Libraries",
    icon: (
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6l-9-4Z" />
        <path d="m8 12 3 3 5-6" />
      </svg>
    ),
  },
];

export function Integrations() {
  return (
    <section className="border-b border-hairline py-10 sm:py-14">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8">
        <div className="text-center" style={{ marginBottom: 32 }}>
          <span className="eyebrow inline-block">Powered by</span>
          <h3
            className="font-serif font-medium m-0"
            style={{ fontSize: 24, letterSpacing: "-0.02em", marginTop: 12 }}
          >
            Built on the infrastructure that secures DeFi.
          </h3>
        </div>
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          style={{
            borderTop: "1px solid var(--hairline)",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          {cells.map((c, i) => (
            <div
              key={c.name}
              className="flex flex-col items-center text-center gap-2"
              style={{
                padding: 24,
                borderRight:
                  i === cells.length - 1 ? "none" : "1px solid var(--hairline)",
              }}
            >
              <div className="h-8 flex items-center">{c.icon}</div>
              <div
                className="font-serif font-medium"
                style={{ fontSize: 17, letterSpacing: "-0.02em" }}
              >
                {c.name}
              </div>
              <div
                className="font-mono text-ink-mute uppercase"
                style={{ fontSize: 10, letterSpacing: "0.08em" }}
              >
                {c.role}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
