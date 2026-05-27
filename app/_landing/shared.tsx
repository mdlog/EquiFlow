/// Two atoms used by multiple landing sections. Kept tiny and shared rather
/// than redefined per file.

export function SectionHead({
  eyebrow,
  title,
  titleEm,
  intro,
  right,
}: {
  eyebrow: string;
  title: string;
  titleEm: string;
  intro?: string;
  right?: string;
}) {
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 sm:pb-7 mb-6 sm:mb-10"
      style={{ borderBottom: "1px solid var(--ink)" }}
    >
      <div className="max-w-[760px]">
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          {eyebrow}
        </div>
        <h2
          className="font-serif font-medium m-0"
          style={{
            fontSize: "clamp(26px, 4vw, 38px)",
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          {title} <em>{titleEm}</em>
        </h2>
        {intro && (
          <p
            className="text-ink-soft"
            style={{
              fontSize: 16,
              lineHeight: 1.55,
              marginTop: 12,
              maxWidth: 600,
            }}
          >
            {intro}
          </p>
        )}
      </div>
      {right && (
        <div
          className="font-mono text-ink-mute uppercase hidden md:block"
          style={{ fontSize: 11, letterSpacing: "0.08em" }}
        >
          {right}
        </div>
      )}
    </div>
  );
}

export function Arrow() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <path d="M2 7h10M8 3l4 4-4 4" />
    </svg>
  );
}
