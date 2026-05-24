import { STOCKS } from "@/lib/config/stocks";
import { SectionHead } from "./shared";

const MAX_LTV = Math.max(...STOCKS.map((s) => s.ltv));

export function HowItWorks() {
  return (
    <section className="border-b border-hairline" style={{ padding: "80px 0" }}>
      <div className="max-w-[1320px] mx-auto px-8">
        <SectionHead
          eyebrow="How EquiFlow works"
          title="Three motions."
          titleEm="One signature."
          intro="EquiFlow's smart wallets (ERC-4337 + EIP-7702 via Alchemy) bundle approve · lock · borrow into a single signature. Gas sponsored by the Alchemy Gas Manager — or pay in USDG via the ERC20 paymaster. No popups. No ETH required. No tax events. Yield routing to external vaults is on the roadmap."
          right="PROTOCOL ARCHITECTURE"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 border border-hairline">
          <Motion
            num="MOTION 01 · PLEDGE"
            title="Lock your stock"
            titleEm="tokens"
            desc="Pledge tokenized shares — AAPL, TSLA, SPY, NVDA, MSFT, GOOGL, QQQ — into the EquiFlow vault. Custody stays on-chain, position stays in your name."
            footLabel="Max LTV"
            footValue={`up to ${(MAX_LTV * 100).toFixed(0)}%`}
            viz={<PledgeViz />}
            isLast={false}
          />
          <Motion
            num="MOTION 02 · BORROW"
            title="Borrow regulated"
            titleEm="stables"
            desc="Draw USDG against your collateral at competitive borrow rates. Funds hit your wallet — or skip your wallet entirely and route straight to yield."
            footLabel="From"
            footValue="variable APR"
            viz={<BorrowViz />}
            isLast={false}
          />
          <Motion
            num="MOTION 03 · EARN"
            title="Auto-route to"
            titleEm="yield"
            desc="Planned: deposit borrowed stables straight into Aave V3 in the same bundle. Vault integration is on the roadmap — the toggle in the composer is visible but disabled until the on-chain route is wired."
            footLabel="Net APY"
            footValue="Coming soon"
            footValueClass="text-ink-mute"
            viz={<EarnViz />}
            isLast={true}
            comingSoon
          />
        </div>
      </div>
    </section>
  );
}

function Motion({
  num,
  title,
  titleEm,
  desc,
  footLabel,
  footValue,
  footValueClass,
  viz,
  isLast,
  comingSoon = false,
}: {
  num: string;
  title: string;
  titleEm: string;
  desc: string;
  footLabel: string;
  footValue: string;
  footValueClass?: string;
  viz: React.ReactNode;
  isLast: boolean;
  comingSoon?: boolean;
}) {
  return (
    <div
      className="bg-white relative"
      style={{
        padding: 32,
        borderRight: isLast ? "none" : "1px solid var(--hairline)",
        opacity: comingSoon ? 0.78 : 1,
      }}
    >
      {comingSoon && (
        <span
          className="font-mono absolute"
          style={{
            top: 14,
            right: 14,
            fontSize: 9,
            letterSpacing: "0.1em",
            padding: "3px 8px",
            border: "1px solid var(--hairline)",
            background: "var(--paper-alt)",
            color: "var(--ink-mute)",
            borderRadius: 2,
          }}
        >
          COMING SOON
        </span>
      )}
      <div
        className="font-mono text-ink-mute flex items-center gap-2.5"
        style={{ fontSize: 11, letterSpacing: "0.16em" }}
      >
        {num}
        <span className="flex-1 h-px bg-hairline" />
      </div>
      <h3
        className="font-serif font-medium m-0"
        style={{
          fontSize: 26,
          letterSpacing: "-0.02em",
          margin: "16px 0 6px",
          lineHeight: 1.1,
        }}
      >
        {title} <em>{titleEm}</em>
      </h3>
      <p
        className="text-ink-soft m-0"
        style={{ fontSize: 13, lineHeight: 1.55 }}
      >
        {desc}
      </p>
      <div
        className="bg-paper-alt border border-hairline-soft flex items-center justify-center"
        style={{
          margin: "24px 0 8px",
          padding: 14,
          minHeight: 110,
        }}
      >
        {viz}
      </div>
      <div
        className="mt-[18px] pt-4 flex justify-between items-baseline"
        style={{ borderTop: "1px dashed var(--hairline-soft)" }}
      >
        <span
          className="text-ink-mute uppercase"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          {footLabel}
        </span>
        <span
          className={`font-mono font-medium ${footValueClass ?? ""}`}
          style={{ fontSize: 13 }}
        >
          {footValue}
        </span>
      </div>
    </div>
  );
}

function PledgeViz() {
  return (
    <svg viewBox="0 0 240 100" width="220" height="84">
      <g
        fontFamily="JetBrains Mono"
        fontSize="10"
        fontWeight="600"
        fill="#1A1814"
      >
        <rect x="6" y="14" width="46" height="22" fill="#FAF8F2" stroke="#1A1814" strokeWidth="1.2" />
        <text x="29" y="29" textAnchor="middle">AAPL</text>
        <rect x="6" y="40" width="46" height="22" fill="#FAF8F2" stroke="#1A1814" strokeWidth="1.2" />
        <text x="29" y="55" textAnchor="middle">NVDA</text>
        <rect x="6" y="66" width="46" height="22" fill="#FAF8F2" stroke="#1A1814" strokeWidth="1.2" />
        <text x="29" y="81" textAnchor="middle">SPY</text>
      </g>
      <path
        d="M58 25 Q90 40 122 40 M58 51 L122 40 M58 77 Q90 60 122 40"
        stroke="#857F72"
        strokeWidth="0.9"
        fill="none"
        strokeDasharray="2 3"
      />
      <rect x="128" y="20" width="100" height="40" fill="#1A1814" />
      <text x="178" y="36" fontFamily="JetBrains Mono" fontSize="8" fill="#FAF8F2" textAnchor="middle" letterSpacing="0.12em">
        EQUIFLOW VAULT
      </text>
      <text x="178" y="50" fontFamily="Source Serif 4" fontSize="12" fontWeight="500" fill="#FAF8F2" textAnchor="middle">
        TVL
      </text>
    </svg>
  );
}

function BorrowViz() {
  return (
    <svg viewBox="0 0 240 80" width="220" height="74">
      <rect x="6" y="20" width="64" height="40" fill="#1A1814" />
      <text x="38" y="38" fontFamily="JetBrains Mono" fontSize="8" fill="#FAF8F2" textAnchor="middle" letterSpacing="0.1em">
        COLLATERAL
      </text>
      <text x="38" y="52" fontFamily="Source Serif 4" fontSize="11" fontWeight="500" fill="#FAF8F2" textAnchor="middle">
        Pledged
      </text>
      <line x1="76" y1="40" x2="160" y2="40" stroke="#857F72" strokeWidth="1" strokeDasharray="3 3" />
      <text x="118" y="34" fontFamily="JetBrains Mono" fontSize="9" fill="#857F72" textAnchor="middle">
        borrow · variable APR
      </text>
      <path d="M156 36 L160 40 L156 44" stroke="#857F72" fill="none" strokeWidth="1" />
      <rect x="164" y="20" width="64" height="40" fill="#FAF8F2" stroke="#1A1814" strokeWidth="1.4" />
      <text x="196" y="38" fontFamily="JetBrains Mono" fontSize="8" fill="#1A1814" textAnchor="middle" letterSpacing="0.1em">
        USDG
      </text>
      <text x="196" y="52" fontFamily="Source Serif 4" fontSize="12" fontWeight="500" fill="#1A1814" textAnchor="middle">
        Borrowed
      </text>
    </svg>
  );
}

function EarnViz() {
  return (
    <svg viewBox="0 0 240 80" width="220" height="74">
      <circle cx="120" cy="40" r="22" fill="none" stroke="#1A1814" strokeWidth="1.4">
        <animate attributeName="r" values="22;24.5;22" dur="3.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.92;1" dur="3.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="120" cy="40" r="14" fill="#1A1814" />
      <text x="120" y="38" fontFamily="JetBrains Mono" fontSize="7" fill="#FAF8F2" textAnchor="middle">
        AAVE V3
      </text>
      <text x="120" y="48" fontFamily="Source Serif 4" fontSize="11" fontWeight="500" fill="#FAF8F2" textAnchor="middle">
        yield
      </text>
      <circle cx="60" cy="40" r="8" fill="#FAF8F2" stroke="#1A1814">
        <animate attributeName="r" values="8;8.9;8" dur="2.2s" repeatCount="indefinite" />
      </circle>
      <text x="60" y="43" fontFamily="JetBrains Mono" fontSize="7" fill="#1A1814" textAnchor="middle">USDC</text>
      <circle cx="180" cy="22" r="6" fill="#FAF8F2" stroke="#1A1814">
        <animate attributeName="r" values="6;6.8;6" dur="4.1s" repeatCount="indefinite" />
      </circle>
      <text x="180" y="25" fontFamily="JetBrains Mono" fontSize="6" fill="#1A1814" textAnchor="middle">GHO</text>
      <circle cx="180" cy="58" r="7" fill="#FAF8F2" stroke="#1A1814">
        <animate attributeName="r" values="7;7.8;7" dur="3.4s" repeatCount="indefinite" />
      </circle>
      <text x="180" y="61" fontFamily="JetBrains Mono" fontSize="6" fill="#1A1814" textAnchor="middle">USDR</text>
      <line x1="68" y1="40" x2="98" y2="40" stroke="#857F72" strokeWidth="0.8" strokeDasharray="2 3" />
      <line x1="174" y1="24" x2="138" y2="32" stroke="#857F72" strokeWidth="0.8" strokeDasharray="2 3" />
      <line x1="173" y1="56" x2="138" y2="48" stroke="#857F72" strokeWidth="0.8" strokeDasharray="2 3" />
    </svg>
  );
}
