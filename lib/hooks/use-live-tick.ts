"use client";

import { useEffect, useState } from "react";

// Random-walk price simulator — dev/demo only. In production, callers
// should use useLiveAdapterTick() from use-adapter-price.ts instead.
export function useLiveTick(
  base: number,
  vol: number,
  format: (v: number) => string = (v) => v.toFixed(2),
) {
  const [value, setValue] = useState(base);
  const [dir, setDir] = useState<-1 | 0 | 1>(0);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const period = 1400 + Math.random() * 1600;
    const interval = setInterval(() => {
      const delta = (Math.random() - 0.5) * vol * base * 0.001;
      setValue((prev) => prev + delta);
      setDir(delta > 0.0001 ? 1 : delta < -0.0001 ? -1 : 0);
    }, period);
    return () => clearInterval(interval);
  }, [base, vol]);

  return { value, formatted: format(value), dir };
}
