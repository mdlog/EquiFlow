import Link from "next/link";
import { AssetLogo } from "@/components/AssetLogo";
import { fmt } from "@/lib/format";
import { STOCKS } from "@/lib/config/stocks";
import { SectionHead } from "./shared";

export function SupportedAssets() {
  return (
    <section className="border-b border-hairline py-12 sm:py-20">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-8">
        <SectionHead
          eyebrow={`Supported assets · ${STOCKS.length} tokenized equities`}
          title="Pledge any of these."
          titleEm="More coming."
          right="REFERENCE PRICES · TESTNET"
        />

        <div className="overflow-x-auto">
          <table
            className="w-full text-[13px]"
            style={{ borderCollapse: "collapse" }}
          >
            <thead>
              <tr>
                {[
                  "Asset",
                  "Last price",
                  "24h",
                  "Max LTV",
                  "Borrow APR",
                  "Vault APR",
                  "Liquidity",
                  "",
                ].map((h, i) => (
                  <th
                    key={i}
                    className="text-ink-mute uppercase font-medium"
                    style={{
                      padding: "12px 16px",
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      borderBottom: "1px solid var(--ink)",
                      textAlign: i === 0 || i === 3 ? "left" : "right",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STOCKS.map((s) => {
                const ltvPct = Math.round(s.ltv * 100);
                return (
                  <tr
                    key={s.sym}
                    className="hover:bg-paper-alt transition-colors"
                    style={{ borderBottom: "1px solid var(--hairline-soft)" }}
                  >
                    <td style={{ padding: 16 }}>
                      <div className="flex items-center gap-3">
                        <div
                          className="flex items-center justify-center"
                          style={{
                            width: 36,
                            height: 36,
                            border: "1px solid var(--ink)",
                            background: "var(--paper)",
                          }}
                        >
                          <AssetLogo sym={s.sym} size={24} />
                        </div>
                        <div>
                          <div
                            className="font-mono font-semibold"
                            style={{ fontSize: 13 }}
                          >
                            {s.sym}
                          </div>
                          <div
                            className="text-ink-mute"
                            style={{ fontSize: 11, marginTop: 2 }}
                          >
                            {s.name} · {s.sector}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td
                      className="text-right font-mono tabular"
                      style={{ padding: 16 }}
                    >
                      {fmt.usd(s.price)}
                    </td>
                    <td
                      className="text-right font-mono tabular text-ink-mute"
                      style={{ padding: 16 }}
                    >
                      —
                    </td>
                    <td style={{ padding: 16 }}>
                      <div className="font-mono tabular">{ltvPct}%</div>
                      <div
                        className="mt-1.5"
                        style={{ height: 3, background: "var(--paper-deep)" }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${ltvPct}%`,
                            background: "var(--ink)",
                          }}
                        />
                      </div>
                    </td>
                    <td
                      className="text-right font-mono tabular"
                      style={{ padding: 16 }}
                    >
                      —
                    </td>
                    <td
                      className="text-right font-mono tabular text-up"
                      style={{ padding: 16 }}
                    >
                      —
                    </td>
                    <td
                      className="text-right font-mono tabular"
                      style={{ padding: 16 }}
                    >
                      —
                    </td>
                    <td className="text-right" style={{ padding: 16 }}>
                      <Link
                        href={`/markets/${s.sym}`}
                        className="btn-ghost btn-sm"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
