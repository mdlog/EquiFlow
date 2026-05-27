import type { ReactNode } from "react";

type Props = {
  kicker?: string;
  title: ReactNode;
  right?: ReactNode;
};

export function SectionHead({ kicker, title, right }: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-3.5 border-b border-ink">
      <div>
        {kicker && <div className="eyebrow mb-1.5">{kicker}</div>}
        <div
          className="font-serif font-medium leading-none tracking-[-0.025em]"
          style={{ fontSize: "clamp(22px, 3.5vw, 28px)" }}
        >
          {title}
        </div>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}
