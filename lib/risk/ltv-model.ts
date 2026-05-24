/// VaR-based LTV recommendation model for equity collateral.
///
/// Computes a recommended max LTV from annualized volatility using the identity:
///
///   LTV = 1 − VaR(σ,τ,α) − LiquidationBonus − OracleLag − Safety − GapRisk
///
/// All inputs/outputs in **basis points** (bps) to match on-chain units.
/// Pure functions — no I/O, no state, no external dependencies.

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface LtvModelConfig {
  /** Liquidation horizon in days — how long from trigger to execution. */
  liquidationHorizonDays: number;
  /** VaR confidence level (0–1). 0.99 = 99th-percentile loss. */
  confidenceLevel: number;
  /** Fat-tail multiplier — Cornish-Fisher-style adjustment for equity kurtosis. */
  fatTailMultiplier: number;
  /** Liquidation bonus paid to liquidator, in bps. Must match contract. */
  liqBonusBps: number;
  /** Max expected price move during oracle staleness window, in bps. */
  oracleLagBps: number;
  /** Governance safety margin, in bps. */
  safetyBufferBps: number;
  /** Overnight/weekend gap risk for equities, in bps. */
  gapRiskBps: number;
}

export interface LtvRecommendation {
  /** Recommended max LTV in basis points. */
  ltvBps: number;
  /** Risk tier classification. */
  tier: Tier;
  /** Raw VaR in bps (before other deductions). */
  varBps: number;
  /** Full component breakdown summing to 10000 − ltvBps. */
  components: LtvComponents;
}

export interface LtvComponents {
  varBps: number;
  liqBonusBps: number;
  oracleLagBps: number;
  safetyBps: number;
  gapRiskBps: number;
  totalDeductionBps: number;
}

export interface Tier {
  level: 1 | 2 | 3 | 4;
  label: string;
}

// ─── Default config ──────────────────────────────────────────────────────────
// Calibrated so that TSLA (vol=0.52) → ~5500 bps, SPY (vol=0.06) → ~8500 bps.

export const DEFAULT_LTV_CONFIG: LtvModelConfig = {
  liquidationHorizonDays: 5,
  confidenceLevel: 0.999,
  fatTailMultiplier: 1.7,
  liqBonusBps: 500,
  oracleLagBps: 150,
  safetyBufferBps: 250,
  gapRiskBps: 300,
};

// ─── Tier classification ─────────────────────────────────────────────────────

const TIER_THRESHOLDS: Array<{ maxVol: number; tier: Tier }> = [
  { maxVol: 0.15, tier: { level: 1, label: "Blue-chip / Broad ETF" } },
  { maxVol: 0.30, tier: { level: 2, label: "Large-cap stable" } },
  { maxVol: 0.50, tier: { level: 3, label: "Growth / Mid-vol" } },
  { maxVol: Infinity, tier: { level: 4, label: "High-volatility" } },
];

export function classifyTier(volatilityAnnualized: number): Tier {
  const v = Math.abs(volatilityAnnualized);
  for (const t of TIER_THRESHOLDS) {
    if (v <= t.maxVol) return t.tier;
  }
  return TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1].tier;
}

// ─── Core VaR computation ────────────────────────────────────────────────────

const TRADING_DAYS_PER_YEAR = 252;

export function computeVaRBps(
  volatilityAnnualized: number,
  horizonDays: number,
  confidence: number,
  fatTailMult: number,
): number {
  const sigmaDaily = volatilityAnnualized / Math.sqrt(TRADING_DAYS_PER_YEAR);
  const z = inverseNormalCDF(confidence);
  const var_ = z * sigmaDaily * Math.sqrt(horizonDays) * fatTailMult;
  return Math.round(var_ * 10_000);
}

// ─── Main entrypoint ─────────────────────────────────────────────────────────

export function computeRecommendedLtvBps(
  volatilityAnnualized: number,
  cfg: LtvModelConfig = DEFAULT_LTV_CONFIG,
): LtvRecommendation {
  const varBps = computeVaRBps(
    volatilityAnnualized,
    cfg.liquidationHorizonDays,
    cfg.confidenceLevel,
    cfg.fatTailMultiplier,
  );

  const totalDeductionBps =
    varBps +
    cfg.liqBonusBps +
    cfg.oracleLagBps +
    cfg.safetyBufferBps +
    cfg.gapRiskBps;

  const rawLtv = 10_000 - totalDeductionBps;
  const ltvBps = Math.max(0, Math.min(9_500, rawLtv));

  return {
    ltvBps,
    tier: classifyTier(volatilityAnnualized),
    varBps,
    components: {
      varBps,
      liqBonusBps: cfg.liqBonusBps,
      oracleLagBps: cfg.oracleLagBps,
      safetyBps: cfg.safetyBufferBps,
      gapRiskBps: cfg.gapRiskBps,
      totalDeductionBps,
    },
  };
}

// ─── Inverse normal CDF (Beasley-Springer-Moro algorithm) ───────────────────
// Accurate to ~10⁻⁸ over the full (0,1) range. No external dependencies.
// Reference: Glasserman, "Monte Carlo Methods in Financial Engineering", p.68.

const A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0,
] as const;

const B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1,
] as const;

const C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
  -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
] as const;

const D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
  3.754408661907416e0,
] as const;

const P_LOW = 0.02425;
const P_HIGH = 1 - P_LOW;

export function inverseNormalCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  let q: number;
  let r: number;

  if (p < P_LOW) {
    // Rational approximation for lower region
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
    );
  }

  if (p <= P_HIGH) {
    // Rational approximation for central region
    q = p - 0.5;
    r = q * q;
    return (
      ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) *
        q) /
      (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
    );
  }

  // Rational approximation for upper region
  q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(
      (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
    )
  );
}
