/// Interest Rate Model — kinked two-slope, Aave V3 style.
///
/// EquiFlow's vault is a single-USDG pool: one borrow rate and one supply
/// rate apply protocol-wide regardless of which equity is posted as collateral.
/// Per-asset differentiation lives in risk parameters (LTV / liq threshold),
/// not in pricing. This module derives both rates from observed utilization.
///
/// Today this runs **client-side** — vault.borrowApyBps() is still owner-set
/// in the contract. Once the IRM is folded into pokeInterest() on-chain the
/// frontend can switch to reading the on-chain value, but the formula here is
/// the canonical one we're optimizing toward.
///
/// All inputs/outputs are in **basis points** (bps) to mirror on-chain units:
///   1 bps = 0.01 %
///   100 bps = 1 %
///   10_000 bps = 100 %
///
/// Default config tuned for the EquiFlow demo:
///   - Slightly lower U_optimal than Aave USDC (92 %) because collateral is
///     volatile equity, so the supplier base needs more headroom for shocks.
///   - Non-zero base rate so suppliers still earn something at low utilization.
///   - Aggressive slope2 makes the penalty visually dramatic for demos.

export interface RateConfig {
  baseBps: number;          // base borrow rate when U = 0
  slope1Bps: number;        // additional rate at U = U_optimal
  slope2Bps: number;        // additional rate at U = 100 % (on top of slope1)
  optimalUtilBps: number;   // kink point
}

export const DEFAULT_RATE_CONFIG: RateConfig = {
  baseBps: 100,           // 1.00 %
  slope1Bps: 500,         // +5.00 % up to optimal → ceiling 6.00 % at U = optimal
  slope2Bps: 7000,        // +70.00 % at U = 100 % → ceiling 76.00 % at full
  optimalUtilBps: 8500,   // U_opt = 85 %
};

/// Compute the variable borrow rate (bps) for a given utilization (bps).
/// Pure function — no I/O, no state, no precision loss above 1 bps.
export function computeBorrowRateBps(
  utilizationBps: number,
  cfg: RateConfig = DEFAULT_RATE_CONFIG,
): number {
  const u = Math.max(0, Math.min(10_000, utilizationBps));
  const { baseBps, slope1Bps, slope2Bps, optimalUtilBps } = cfg;
  if (u <= optimalUtilBps) {
    return baseBps + (u * slope1Bps) / Math.max(1, optimalUtilBps);
  }
  const excess = u - optimalUtilBps;
  const maxExcess = Math.max(1, 10_000 - optimalUtilBps);
  return baseBps + slope1Bps + (excess * slope2Bps) / maxExcess;
}

/// Supply (LP) rate (bps) derived from borrow rate, utilization, and reserve
/// factor. Identity: `R_supply = R_borrow × U × (1 − RF)`.
///
/// This is guaranteed ≤ R_borrow because U ≤ 1 and (1 − RF) ≤ 1 — the system
/// is self-funding and never pays suppliers more than borrowers contribute.
export function computeSupplyRateBps(
  borrowRateBps: number,
  utilizationBps: number,
  reserveFactorBps: number,
): number {
  const u = Math.max(0, Math.min(10_000, utilizationBps));
  const rf = Math.max(0, Math.min(10_000, reserveFactorBps));
  const oneMinusRF = 10_000 - rf;
  // borrow × U × (1−RF), keeping bps-scale (divide twice by 10_000).
  return (borrowRateBps * u * oneMinusRF) / (10_000 * 10_000);
}

/// Continuous-compound approximation `APY ≈ e^APR − 1`. Aave uses a Taylor
/// expansion on-chain for gas reasons; for display in JS, `Math.expm1` is
/// the cleanest numeric form. Both rates in **decimal** (0.05 = 5 %),
/// converted from/to bps at the boundary.
export function aprBpsToApyBps(aprBps: number): number {
  const apr = aprBps / 10_000;
  const apy = Math.expm1(apr); // e^apr − 1
  return apy * 10_000;
}

/// Convenience aggregator — given the current utilization + reserve factor,
/// returns both derived rates and the underlying utilization in bps. Used by
/// useProtocolStats so call-sites get a single readable record.
export interface DerivedRates {
  utilizationBps: number;
  borrowAprBps: number;
  borrowApyBps: number;
  supplyAprBps: number;
  supplyApyBps: number;
  reserveFactorBps: number;
}

export function deriveRates(
  utilizationBps: number,
  reserveFactorBps: number,
  cfg: RateConfig = DEFAULT_RATE_CONFIG,
): DerivedRates {
  const borrowAprBps = computeBorrowRateBps(utilizationBps, cfg);
  const supplyAprBps = computeSupplyRateBps(
    borrowAprBps,
    utilizationBps,
    reserveFactorBps,
  );
  return {
    utilizationBps,
    borrowAprBps,
    borrowApyBps: aprBpsToApyBps(borrowAprBps),
    supplyAprBps,
    supplyApyBps: aprBpsToApyBps(supplyAprBps),
    reserveFactorBps,
  };
}

/// Sample the borrow-rate curve at N evenly-spaced utilization values from
/// 0 to 100 %. Used by chart components to draw the kink visually.
export function sampleCurve(
  points = 50,
  cfg: RateConfig = DEFAULT_RATE_CONFIG,
): Array<{ u: number; rate: number }> {
  const out: Array<{ u: number; rate: number }> = [];
  for (let i = 0; i <= points; i++) {
    const u = (i * 10_000) / points;
    out.push({ u, rate: computeBorrowRateBps(u, cfg) });
  }
  return out;
}
