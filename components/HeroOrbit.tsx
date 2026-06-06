"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { AssetLogo } from "@/components/AssetLogo";
import { STOCKS } from "@/lib/config/stocks";
import { useProtocolStats, useListedAssets } from "@/lib/hooks/use-protocol-stats";
import { fmt } from "@/lib/format";

const SYMS = STOCKS.map((s) => s.sym);
const N = SYMS.length;
const CENTER = 240;
const RADIUS = 178;
const HUB_R = 60;
const BADGE_GAP = 32;

const LENS_SIZE = 150;
const ZOOM = 1.9;
const ORBIT_RADIUS_PCT = (RADIUS / 480) * 100;

type Stable = { label: string; src: string; tint: string };
const STABLES: Stable[] = [
  { label: "USDC", src: "/logo-usdc.png", tint: "#1f6feb" },
  { label: "USDG", src: "/logo-usdg.png", tint: "#7faf3b" },
];

type Phase = "idle" | "deposit" | "lock" | "borrow" | "settle";

const SEQUENCE: { phase: Phase; dur: number }[] = [
  { phase: "deposit", dur: 1100 },
  { phase: "lock", dur: 900 },
  { phase: "borrow", dur: 1700 },
  { phase: "settle", dur: 600 },
  { phase: "idle", dur: 250 },
];

const REVOLUTION_HOLD_MS = 1700;

type Flow = {
  phase: Phase;
  cycle: number;
  stockSym: string;
  stable: Stable;
  startXPct: number;
  startYPct: number;
  endXPct: number;
  endYPct: number;
  slots: (Stable | null)[];
  resetTick: number;
};

export function HeroOrbit() {
  const listed = useListedAssets();
  const stats = useProtocolStats(listed);
  const tvlLabel =
    stats.tvlUsd != null
      ? "TVL · $" + fmt.abbr(Number(formatUnits(stats.tvlUsd, 18)))
      : "TVL · —";

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [cycle, setCycle] = useState(0);
  const [slots, setSlots] = useState<(Stable | null)[]>(() =>
    Array(N).fill(null)
  );
  const [resetTick, setResetTick] = useState(0);
  // `interactive` = devices with a real pointer (desktop). The magnifier lens
  // renders a SECOND full copy of the orbit, so on touch — where the lens can
  // never show — we skip it entirely (~halves the animation work on mobile).
  // `reducedMotion` pauses the perpetual rotation + flow story.
  const [interactive, setInteractive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const hoverMq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setInteractive(hoverMq.matches);
      setReducedMotion(motionMq.matches);
    };
    apply();
    hoverMq.addEventListener("change", apply);
    motionMq.addEventListener("change", apply);
    return () => {
      hoverMq.removeEventListener("change", apply);
      motionMq.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (reducedMotion) {
      el.style.setProperty("--ef-hero-rot", "0deg");
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const deg = ((elapsed / 30000) * 360) % 360;
      el.style.setProperty("--ef-hero-rot", `${deg}deg`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) {
      setPhase("idle");
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let stepIdx = 0;
    let cur = 0;

    const tick = () => {
      const step = SEQUENCE[stepIdx];
      setPhase(step.phase);

      if (step.phase === "settle") {
        const slotIdx = cur % N;
        const stable = STABLES[cur % STABLES.length];
        setSlots((prev) => {
          const next = [...prev];
          next[slotIdx] = stable;
          return next;
        });
      }

      const lastOfRevolution =
        step.phase === "settle" && (cur + 1) % N === 0;
      const duration = lastOfRevolution
        ? step.dur + REVOLUTION_HOLD_MS
        : step.dur;

      timer = setTimeout(() => {
        const nextIdx = (stepIdx + 1) % SEQUENCE.length;
        if (SEQUENCE[nextIdx].phase === "deposit") {
          cur += 1;
          if (cur % N === 0) {
            setSlots(Array(N).fill(null));
            setResetTick((t) => t + 1);
          }
          setCycle(cur);
        }
        stepIdx = nextIdx;
        tick();
      }, duration);
    };
    tick();
    return () => clearTimeout(timer);
  }, [reducedMotion]);

  const stockIdx = cycle % N;
  const stableIdx = cycle % STABLES.length;
  const stockSym = SYMS[stockIdx];
  const stable = STABLES[stableIdx];

  const depAngle = -Math.PI / 2 + (stockIdx * 2 * Math.PI) / N;
  const startXPct = 50 + ORBIT_RADIUS_PCT * Math.cos(depAngle);
  const startYPct = 50 + ORBIT_RADIUS_PCT * Math.sin(depAngle);
  const endXPct = startXPct;
  const endYPct = startYPct;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setLens({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };
  const handleLeave = () => setLens(null);

  const lensX = lens?.x ?? 0;
  const lensY = lens?.y ?? 0;

  // The SVG scales via its 480 viewBox, but the HTML overlays (hub, badges)
  // are authored in that same 480 coordinate space and must be scaled to match
  // the measured container — otherwise the fixed-px overlays stay oversized on
  // a narrow mobile column. 0 until measured (one frame) to avoid an overflow
  // flash before the ResizeObserver fires.
  const scale = size.w ? size.w / 480 : 0;

  const flow: Flow = {
    phase,
    cycle,
    stockSym,
    stable,
    startXPct,
    startYPct,
    endXPct,
    endYPct,
    slots,
    resetTick,
  };

  return (
    <aside
      className="relative border border-hairline rounded-[2px]"
      style={{ padding: 24, background: "transparent" }}
    >
      <span
        className="absolute"
        style={{
          top: -1,
          left: 24,
          right: 24,
          height: 2,
          background: "var(--ink)",
        }}
      />

      <div
        className="flex justify-between items-baseline pb-3.5"
        style={{ borderBottom: "1px solid var(--hairline-soft)" }}
      >
        <span
          className="font-mono text-ink-mute uppercase"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          EquiFlow · Constellation
        </span>
        <span
          className="font-mono text-ink-mute uppercase inline-flex items-center"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          <span
            className="rounded-full mr-1.5 inline-block bg-up"
            style={{
              width: 6,
              height: 6,
              animation: "ef-breathe 2.2s ease-in-out infinite",
            }}
          />
          {N} markets · streaming
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative"
        style={{
          aspectRatio: "1 / 1",
          marginTop: 18,
          marginBottom: 18,
          cursor: interactive ? "zoom-in" : "default",
        }}
        onMouseMove={interactive ? handleMove : undefined}
        onMouseLeave={interactive ? handleLeave : undefined}
      >
        <OrbitContent idSuffix="base" flow={flow} scale={scale} />

        {interactive && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: lensX - LENS_SIZE / 2,
            top: lensY - LENS_SIZE / 2,
            width: LENS_SIZE,
            height: LENS_SIZE,
            borderRadius: "9999px",
            overflow: "hidden",
            border: "1.5px solid var(--ink)",
            boxShadow:
              "0 10px 28px rgba(20,18,14,0.22), inset 0 0 0 4px rgba(250,248,242,0.85), inset 0 0 0 5px rgba(26,24,20,0.18)",
            background: "var(--paper)",
            opacity: lens ? 1 : 0,
            transition: "opacity 0.18s ease-out",
            willChange: "left, top, opacity",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: size.w || 1,
              height: size.h || 1,
              transformOrigin: "0 0",
              transform: lens
                ? `translate(${LENS_SIZE / 2 - lens.x * ZOOM}px, ${LENS_SIZE / 2 - lens.y * ZOOM}px) scale(${ZOOM})`
                : "translate(0,0) scale(1)",
            }}
          >
            <OrbitContent idSuffix="lens" flow={flow} scale={scale} />
          </div>

          <span
            className="absolute"
            style={{
              left: "50%",
              top: "50%",
              width: 1,
              height: 12,
              background: "rgba(26,24,20,0.25)",
              transform: "translate(-50%,-50%)",
            }}
          />
          <span
            className="absolute"
            style={{
              left: "50%",
              top: "50%",
              width: 12,
              height: 1,
              background: "rgba(26,24,20,0.25)",
              transform: "translate(-50%,-50%)",
            }}
          />
        </div>
        )}
      </div>

      <div
        className="pt-3.5 flex items-baseline justify-between"
        style={{ borderTop: "1px solid var(--hairline-soft)" }}
      >
        <span
          className="text-ink-mute uppercase"
          style={{ fontSize: 10, letterSpacing: "0.12em" }}
        >
          1 protocol · {N} markets · 1 signature
        </span>
        <span className="font-mono tabular text-ink" style={{ fontSize: 11 }}>
          {tvlLabel}
        </span>
      </div>
    </aside>
  );
}

function LockGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5"
        stroke="var(--ink)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect
        x="4.5"
        y="10.5"
        width="15"
        height="10"
        rx="1.8"
        fill="var(--ink)"
        stroke="var(--ink)"
        strokeWidth="1.4"
      />
      <circle cx="12" cy="15" r="1.5" fill="var(--paper)" />
      <rect x="11.4" y="15" width="1.2" height="3" rx="0.6" fill="var(--paper)" />
    </svg>
  );
}

function OrbitContent({
  idSuffix,
  flow,
  scale,
}: {
  idSuffix: string;
  flow: Flow;
  scale: number;
}) {
  const glowId = `ef-orbit-glow-${idSuffix}`;
  const collateralActive =
    flow.phase === "lock" ||
    flow.phase === "borrow" ||
    flow.phase === "settle";
  const activeIdx = flow.cycle % N;
  const activeWasStock = flow.slots[activeIdx] === null;
  const showDeposit = flow.phase === "deposit" && activeWasStock;
  const showBorrow = flow.phase === "borrow";

  return (
    <>
      <svg
        viewBox="0 0 480 480"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(26,24,20,0.07)" />
            <stop offset="55%" stopColor="rgba(26,24,20,0.02)" />
            <stop offset="100%" stopColor="rgba(26,24,20,0)" />
          </radialGradient>
        </defs>

        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS + 55}
          fill={`url(#${glowId})`}
        />

        <g
          style={{
            transformBox: "fill-box",
            transformOrigin: "center",
            transform: "rotate(var(--ef-hero-rot, 0deg))",
          }}
        >
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS + 24}
            fill="none"
            stroke="var(--hairline)"
            strokeWidth="1"
            strokeDasharray="2 8"
          />
        </g>

        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="var(--hairline-soft)"
          strokeWidth="1"
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS - 50}
          fill="none"
          stroke="var(--hairline-soft)"
          strokeWidth="1"
          strokeDasharray="1 5"
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS - 100}
          fill="none"
          stroke="var(--hairline-soft)"
          strokeWidth="1"
          strokeDasharray="1 5"
        />

        {[0, 1.4, 2.8].map((d, i) => (
          <circle
            key={i}
            cx={CENTER}
            cy={CENTER}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="1"
          >
            <animate
              attributeName="r"
              values={`${HUB_R + 4};${RADIUS - 6}`}
              dur="4.2s"
              begin={`${d}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.45;0"
              dur="4.2s"
              begin={`${d}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}

        <g
          style={{
            transformBox: "fill-box",
            transformOrigin: "center",
            transform: "rotate(var(--ef-hero-rot, 0deg))",
          }}
        >
          {SYMS.map((s, i) => {
            const angle = -Math.PI / 2 + (i * 2 * Math.PI) / N;
            const dx = Math.cos(angle);
            const dy = Math.sin(angle);
            const x1 = CENTER + dx * HUB_R;
            const y1 = CENTER + dy * HUB_R;
            const x2 = CENTER + dx * (RADIUS - BADGE_GAP);
            const y2 = CENTER + dy * (RADIUS - BADGE_GAP);
            const segLen = Math.hypot(x2 - x1, y2 - y1);
            return (
              <g key={s}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--hairline)"
                  strokeWidth="1"
                />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--ink)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeDasharray={`6 ${segLen}`}
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    values={`0;-${segLen + 6}`}
                    dur="3.2s"
                    begin={`${i * 0.32}s`}
                    repeatCount="indefinite"
                  />
                </line>
                <circle cx={x2} cy={y2} r="2.4" fill="var(--ink)" />
              </g>
            );
          })}
        </g>
      </svg>

      {/* HTML overlays authored in the 480 coordinate space, scaled to match
          the SVG viewBox so badges/hub shrink with the container on mobile. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 480,
          height: 480,
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          opacity: scale ? 1 : 0,
        }}
      >
      <div
        className="absolute inset-0"
        style={{
          transform: "rotate(var(--ef-hero-rot, 0deg))",
          zIndex: 4,
        }}
      >
        {SYMS.map((s, i) => {
          const angle = -Math.PI / 2 + (i * 2 * Math.PI) / N;
          const xPct = 50 + ORBIT_RADIUS_PCT * Math.cos(angle);
          const yPct = 50 + ORBIT_RADIUS_PCT * Math.sin(angle);
          const isActive = i === activeIdx;
          const replaced = flow.slots[i];
          const hideForFlight =
            isActive &&
            (flow.phase === "deposit" ||
              flow.phase === "lock" ||
              flow.phase === "borrow") &&
            replaced === null;
          const showActiveStockHighlight =
            isActive && replaced === null && !hideForFlight;
          return (
            <div
              key={s}
              className="absolute"
              style={{
                left: `${xPct}%`,
                top: `${yPct}%`,
                width: 52,
                height: 52,
                marginLeft: -26,
                marginTop: -26,
                transform:
                  "rotate(calc(-1 * var(--ef-hero-rot, 0deg)))",
              }}
            >
              <div
                className="relative"
                style={{
                  width: 52,
                  height: 52,
                  animation: `ef-float ${3.6 + i * 0.21}s ease-in-out infinite`,
                  animationDelay: `${i * 0.17}s`,
                  opacity: hideForFlight ? 0 : 1,
                  transition: "opacity 0.3s ease",
                }}
              >
                {replaced ? (
                  <div
                    key={`stable-${i}-${flow.resetTick}`}
                    className="flex items-center justify-center bg-white overflow-hidden"
                    style={{
                      width: 52,
                      height: 52,
                      border: `1.4px solid ${replaced.tint}`,
                      borderRadius: "9999px",
                      boxShadow: `0 1px 0 var(--hairline-soft), 0 0 0 2px ${replaced.tint}15`,
                      animation:
                        "ef-slot-land 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
                    }}
                  >
                    <img
                      src={replaced.src}
                      alt={replaced.label}
                      style={{
                        width: 40,
                        height: 40,
                        objectFit: "contain",
                        display: "block",
                      }}
                    />
                  </div>
                ) : (
                  <div
                    key={`stock-${i}-${flow.resetTick}`}
                    className="flex items-center justify-center bg-white overflow-hidden"
                    style={{
                      width: 52,
                      height: 52,
                      border: showActiveStockHighlight
                        ? "1.6px solid var(--ink)"
                        : "1.2px solid var(--ink)",
                      borderRadius: "9999px",
                      boxShadow: showActiveStockHighlight
                        ? "0 0 0 2px var(--paper), 0 0 0 3px var(--ink), 0 1px 0 var(--hairline-soft)"
                        : "0 1px 0 var(--hairline-soft)",
                      transition: "box-shadow 0.35s ease, border 0.35s ease",
                      animation:
                        flow.resetTick > 0
                          ? "ef-slot-reset 0.5s ease-out both"
                          : undefined,
                    }}
                  >
                    <AssetLogo sym={s} size={36} rounded />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {showDeposit && (
          <div
            key={`dep-${flow.cycle}`}
            className="absolute pointer-events-none"
            style={
              {
                width: 52,
                height: 52,
                zIndex: 8,
                "--from-x": `${flow.startXPct}%`,
                "--from-y": `${flow.startYPct}%`,
                animation:
                  "ef-flow-in 1.1s cubic-bezier(0.55, 0.05, 0.6, 0.95) both",
              } as React.CSSProperties
            }
          >
            <div
              style={{
                width: 52,
                height: 52,
                transform:
                  "rotate(calc(-1 * var(--ef-hero-rot, 0deg)))",
              }}
            >
              <div
                className="flex items-center justify-center bg-white overflow-hidden"
                style={{
                  width: 52,
                  height: 52,
                  border: "1.2px solid var(--ink)",
                  borderRadius: "9999px",
                  boxShadow: "0 1px 0 var(--hairline-soft)",
                }}
              >
                <AssetLogo sym={flow.stockSym} size={36} rounded />
              </div>
            </div>
          </div>
        )}

        {showBorrow && (
          <div
            key={`bor-${flow.cycle}`}
            className="absolute pointer-events-none"
            style={
              {
                width: 52,
                height: 52,
                zIndex: 8,
                "--to-x": `${flow.endXPct}%`,
                "--to-y": `${flow.endYPct}%`,
                animation:
                  "ef-flow-out 1.6s cubic-bezier(0.55, 0.05, 0.6, 0.95) both",
              } as React.CSSProperties
            }
          >
            <div
              style={{
                position: "relative",
                width: 52,
                height: 52,
                transform:
                  "rotate(calc(-1 * var(--ef-hero-rot, 0deg)))",
              }}
            >
              <div
                className="flex items-center justify-center bg-white overflow-hidden"
                style={{
                  width: 52,
                  height: 52,
                  border: `1.4px solid ${flow.stable.tint}`,
                  borderRadius: "9999px",
                  boxShadow: `0 1px 0 var(--hairline-soft), 0 0 0 2px ${flow.stable.tint}15`,
                }}
              >
                <img
                  src={flow.stable.src}
                  alt={flow.stable.label}
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              </div>
              <span
                className="font-mono"
                style={{
                  position: "absolute",
                  top: -14,
                  left: "50%",
                  transform: "translateX(-50%)",
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  color: flow.stable.tint,
                  background: "var(--paper)",
                  padding: "1px 5px",
                  border: `1px solid ${flow.stable.tint}`,
                  borderRadius: 1,
                  whiteSpace: "nowrap",
                  animation:
                    "ef-stable-label 1.6s cubic-bezier(0.55, 0.05, 0.6, 0.95) both",
                }}
              >
                {flow.stable.label}
              </span>
            </div>
          </div>
        )}
      </div>

      <div
        className="absolute"
        style={{
          left: "50%",
          top: "50%",
          transform: collateralActive
            ? "translate(-50%, -50%) scale(0.96)"
            : "translate(-50%, -50%) scale(1)",
          transition:
            "transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div
          className="flex flex-col items-center justify-center"
          style={{
            width: 112,
            height: 112,
            background: "var(--paper)",
            border: "1.5px solid var(--ink)",
            borderRadius: "9999px",
            boxShadow:
              "0 0 0 6px var(--paper), 0 0 0 7px var(--hairline-soft)",
            animation: collateralActive
              ? "ef-hub-pulse 2.6s ease-in-out infinite"
              : undefined,
          }}
        >
          <div
            style={{
              animation: "ef-breathe 4s ease-in-out infinite",
              opacity:
                flow.phase === "lock" || flow.phase === "borrow"
                  ? 0.12
                  : 1,
              transition:
                "opacity 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <img
              src="/logo-equiflow.png"
              alt=""
              width={48}
              height={48}
              loading="lazy"
              decoding="async"
              style={{ height: 48, width: "auto", display: "block" }}
            />
          </div>
        </div>
      </div>

      {collateralActive && (
        <div
          key={`stock-${flow.cycle}`}
          className="absolute pointer-events-none"
          style={{
            left: "50%",
            top: "50%",
            width: 64,
            height: 64,
            transform: "translate(-50%, -50%)",
            animation: "ef-stock-lock-in 3.2s cubic-bezier(0.4, 0, 0.2, 1) both",
            zIndex: 6,
          }}
        >
          <div
            className="flex items-center justify-center bg-white overflow-hidden"
            style={{
              width: 64,
              height: 64,
              border: "1.2px solid var(--ink)",
              borderRadius: "9999px",
              boxShadow: "0 1px 0 var(--hairline-soft)",
            }}
          >
            <AssetLogo sym={flow.stockSym} size={44} rounded />
          </div>
        </div>
      )}

      {collateralActive && (
        <div
          key={`lock-${flow.cycle}`}
          className="absolute pointer-events-none"
          style={{
            left: "50%",
            top: "50%",
            zIndex: 7,
            animation: "ef-lock-pop 2.7s 0.5s cubic-bezier(0.4, 0, 0.2, 1) both",
          }}
        >
          <div
            className="flex items-center justify-center"
            style={{
              width: 30,
              height: 30,
              borderRadius: "9999px",
              background: "var(--paper)",
              border: "1.4px solid var(--ink)",
              boxShadow: "0 1px 0 var(--hairline-soft)",
            }}
          >
            <LockGlyph size={18} />
          </div>
        </div>
      )}
      </div>
    </>
  );
}
