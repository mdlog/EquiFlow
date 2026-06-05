/// Numeric constants used throughout the protocol UI. Centralised so a future
/// change to USDG accounting precision (e.g. swap to a 6-dec native USDC rail)
/// is a one-line edit, not a 15-file sweep.

/// USDG is denominated in 1e18 USD for borrow accounting in the vault — this
/// is the scale used by parseUnits / formatUnits when converting user-facing
/// USD numbers to/from bigint.
export const USDG_USD_DECIMALS = 18 as const;

/// Health factor and liquidation calculations use the same 1e18 fixed-point
/// scale as USDG accounting.
export const HEALTH_FACTOR_DECIMALS = 18 as const;

/// LTV / bps scale. Vault stores LTV caps and liquidation thresholds in basis
/// points (10_000 = 100%).
export const BPS = 10_000 as const;

/// Liquidation threshold cushion applied above LTV cap when the on-chain
/// `liqLtvBps` is not yet available client-side. This is a stop-gap — the
/// canonical source is `vault.assets(token).liqLtvBps`. Track removal in
/// docs/hardcoded-data-audit.md (C3).
export const LIQ_LTV_CUSHION_BPS = 1000 as const;
