/// Interest Rate Model — kinked two-slope, Aave V3 style.
///
/// EquiFlow's vault is a single-USDG pool: one borrow rate and one supply
/// rate apply protocol-wide regardless of which equity is posted as collateral.
/// Per-asset differentiation lives in risk parameters (LTV / liq threshold),
/// not in pricing. This module derives both rates from observed utilization.
///
/// On-chain authority
/// ──────────────────
/// As of the feat/onchain-irm release, `EquiFlowVault.borrowApyBps()` reads
/// from a deployed `KinkedRateModel` contract (set via vault.executeIrm
/// after the 24h timelock). The functions below remain canonical because:
///
///   - SSR / build-time render paths cannot call wagmi hooks. The pure
///     `computeBorrowRateBps` is the deterministic fallback so the first
///     paint shows sensible numbers before any RPC roundtrip.
///   - Chart curves (`sampleCurve`) need N points. Reading N points from
///     on-chain costs N RPC calls; the client-side curve is identical to
///     the on-chain implementation (verified by `KinkedRateModel.t.sol`).
///   - When IRM parameters change (governance deploys a new model + swaps),
///     update `DEFAULT_RATE_CONFIG` below so client + on-chain remain in
///     sync. The audit-fix invariant is that ON-CHAIN is authoritative.
///
/// All inputs/outputs are in **basis points** (bps) to mirror on-chain units:
///   1 bps = 0.01 %
///   100 bps = 1 %
///   10_000 bps = 100 %
///
/// Default config matches contracts/script/Deploy.s.sol:
///   - base=1.00%, slope1=5.00%, slope2=49.00%, U_opt=85%
///   - slope2 trimmed from the historical demo value (70%) so worst-case
///     at U=100% (55%) sits just above the vault's MAX_BORROW_RATE_BPS
///     clamp (50%). The clamp at the vault is the authoritative cap.

export interface RateConfig {
  baseBps: number;          // base borrow rate when U = 0
  slope1Bps: number;        // additional rate at U = U_optimal
  slope2Bps: number;        // additional rate at U = 100 % (on top of slope1)
  optimalUtilBps: number;   // kink point
}

export const DEFAULT_RATE_CONFIG: RateConfig = {
  // Mirrors contracts/script/Deploy.s.sol KinkedRateModel constructor args.
  // Source of truth is on-chain; this is a fallback for SSR / off-line.
  baseBps: 100,           // 1.00 %
  slope1Bps: 500,         // +5.00 % up to optimal → ceiling 6.00 % at U_opt
  slope2Bps: 4900,        // +49.00 % at U = 100 % → ceiling 55 %; vault
                          //          clamps to MAX_BORROW_RATE_BPS = 50 %
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

/// ─── On-chain integration helpers ────────────────────────────────────────
///
/// ABI fragment matching contracts/src/interest/IInterestRateModel.sol +
/// KinkedRateModel.sol. Import this where wagmi `useReadContract` needs to
/// pull the live rate or the immutable curve params.
///
/// To read the active model:
///   1. `useReadContract({ abi: EQUIFLOW_VAULT_ABI, functionName: "irm" })`
///      → returns the IRM contract address (or address(0) if not yet wired).
///   2. With that address, call `getBorrowRate(utilizationBps)` for live
///      rate, or read `baseBps/slope1Bps/slope2Bps/optimalUtilBps` for curve
///      params so charts can render the exact on-chain shape.
///
/// To read the current effective borrow APY at the live utilization:
///   `useReadContract({ abi: EQUIFLOW_VAULT_ABI, functionName: "borrowApyBps" })`
///   already delegates through the IRM and applies the vault's clamp —
///   that's the preferred single-call path for headline UI metrics.
export const KINKED_RATE_MODEL_ABI = [
  {
    type: "function",
    name: "getBorrowRate",
    stateMutability: "view",
    inputs: [{ name: "utilizationBps", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "baseBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "slope1Bps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "slope2Bps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "optimalUtilBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

/// Build a curve sample request for `useReadContracts` so a chart can plot
/// the LIVE on-chain curve in one batched RPC call instead of N round-trips
/// through the client formula.
///
/// Returns an array of contract-call descriptors. Pair with `useReadContracts`
/// to fetch them in parallel, then `(result, i) => ({ u: i * 10_000 / points,
/// rate: Number(result[i].result) })`.
export function buildCurveReadCalls(
  irmAddress: `0x${string}`,
  points = 24,
): Array<{
  abi: typeof KINKED_RATE_MODEL_ABI;
  address: `0x${string}`;
  functionName: "getBorrowRate";
  args: [bigint];
}> {
  const out = [];
  for (let i = 0; i <= points; i++) {
    const u = BigInt(Math.round((i * 10_000) / points));
    out.push({
      abi: KINKED_RATE_MODEL_ABI,
      address: irmAddress,
      functionName: "getBorrowRate" as const,
      args: [u] as [bigint],
    });
  }
  return out;
}
