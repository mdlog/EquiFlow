"use client";

import { useEffect, useRef, useState } from "react";

/// Scroll-entrance wrapper in the page's existing motion grammar (ef-fade-in,
/// 4px rise). Safety rules:
///   - Server HTML renders children fully visible — content never depends on
///     JS to be readable (no-JS, crawlers, slow hydration).
///   - The pre-reveal hidden state is applied only AFTER mount, and only to
///     elements still below the viewport — nothing already on screen blinks.
///   - prefers-reduced-motion users never get the hidden state at all.
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"visible" | "hidden" | "revealed">(
    "visible",
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Only elements still below the fold participate — anything already (or
    // nearly) on screen at mount stays untouched.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    setState("hidden");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("revealed");
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={
        state === "hidden"
          ? { opacity: 0 }
          : state === "revealed"
            ? { animation: `ef-fade-in 0.5s ease-out ${delay}ms both` }
            : undefined
      }
    >
      {children}
    </div>
  );
}
