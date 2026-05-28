// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IInterestRateModel} from "./IInterestRateModel.sol";

/// @title  KinkedRateModel
/// @notice Aave V3 / Compound V2 style two-slope kinked variable borrow
///         curve. Pure-view, stateless, immutable parameters.
///
///         Formula:
///           if U ≤ U_opt   →  base + slope1 × (U / U_opt)
///           if U  > U_opt   →  base + slope1 + slope2 × (U − U_opt) / (1 − U_opt)
///
///         Immutability is deliberate: once a vault points at a model, the
///         curve cannot move out from under borrowers without a visible
///         governance step (vault.scheduleIrm → executeIrm). To "change"
///         a model, deploy a new contract with the new parameters and
///         schedule it.
contract KinkedRateModel is IInterestRateModel {
    uint256 public constant BPS = 10_000;

    /// @notice Borrow rate when utilization is 0.
    uint256 public immutable baseBps;
    /// @notice Additional rate accrued linearly between U = 0 and U_opt.
    uint256 public immutable slope1Bps;
    /// @notice Additional rate accrued linearly between U_opt and U = 100%.
    uint256 public immutable slope2Bps;
    /// @notice Kink utilization (bps). Curve gradient switches here.
    uint256 public immutable optimalUtilBps;

    string private _name;

    error InvalidConfig();

    constructor(
        string memory name_,
        uint256 _baseBps,
        uint256 _slope1Bps,
        uint256 _slope2Bps,
        uint256 _optimalUtilBps
    ) {
        // 0 < optimal < 100% — required for the division in the high branch.
        if (_optimalUtilBps == 0 || _optimalUtilBps >= BPS) revert InvalidConfig();
        // Hard cap: worst-case (U=100%) rate must not exceed 100% APR.
        // Vault layer still clamps to its own MAX_BORROW_RATE_BPS (defense
        // in depth).
        if (_baseBps + _slope1Bps + _slope2Bps > BPS) revert InvalidConfig();
        _name = name_;
        baseBps = _baseBps;
        slope1Bps = _slope1Bps;
        slope2Bps = _slope2Bps;
        optimalUtilBps = _optimalUtilBps;
    }

    /// @inheritdoc IInterestRateModel
    function getBorrowRate(uint256 utilizationBps)
        external
        view
        returns (uint256)
    {
        // Clamp pathological inputs. utilizationBps should never exceed
        // BPS but a buggy caller would otherwise yield surprising rates.
        uint256 u = utilizationBps > BPS ? BPS : utilizationBps;
        if (u <= optimalUtilBps) {
            // base + (u / optimal) × slope1
            return baseBps + (u * slope1Bps) / optimalUtilBps;
        }
        // base + slope1 + ((u − optimal) / (BPS − optimal)) × slope2
        uint256 excess = u - optimalUtilBps;
        uint256 maxExcess = BPS - optimalUtilBps;
        return baseBps + slope1Bps + (excess * slope2Bps) / maxExcess;
    }

    /// @inheritdoc IInterestRateModel
    function name() external view returns (string memory) {
        return _name;
    }
}
