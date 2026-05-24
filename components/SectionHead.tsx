import type { ReactNode } from "react";

type Props = {
  kicker?: string;
  title: ReactNode;
  right?: ReactNode;
};

export function SectionHead({ kicker, title, right }: Props) {
  return (
    <div className="flex items-end justify-between pb-3.5 border-b border-ink">
      <div>
        {kicker && <div className="eyebrow mb-1.5">{kicker}</div>}
        <div
          className="font-serif font-medium leading-none tracking-[-0.025em]"
          style={{ fontSize: 28 }}
        >
          {title}
        </div>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}
