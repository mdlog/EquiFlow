// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Interest Rate Model interface
/// @notice Stateless variable borrow-rate oracle. Vaults pass utilization
///         and read back the annual borrow rate in basis points.
///
///         Contract is intentionally minimal so multiple model shapes
///         (kinked two-slope, target-utilization adaptive, PID, etc.) can
///         all conform. Vaults stay agnostic to which curve is in use.
interface IInterestRateModel {
    /// @notice Current variable borrow rate at the given utilization.
    /// @param utilizationBps in [0, 10_000]. 10_000 = 100% utilization.
    /// @return borrowRateBps annual borrow rate in basis points. The
    ///         consumer (vault) is expected to clamp the result against
    ///         its own MAX_BORROW_RATE_BPS for defense in depth.
    function getBorrowRate(uint256 utilizationBps)
        external
        view
        returns (uint256 borrowRateBps);

    /// @notice Human-readable model identifier for explorers, risk
    ///         dashboards, and event logs (e.g. "Kinked v1", "Aave-style
    ///         USDC", "PID adaptive"). Treat as informational only.
    function name() external view returns (string memory);
}
