// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  VaultMath
/// @notice External library extracted from `EquiFlowVault` to fit the EIP-170
///         contract size limit. All functions operate on the calling vault's
///         storage via delegatecall — events emit from the vault's address.
///
///         The library is stateless; it holds no storage of its own. Each
///         function takes the relevant vault storage slots as `storage`
///         pointer parameters.
library VaultMath {
    uint256 private constant INDEX_DECIMALS = 1e18;

    event BorrowCapReleased(address indexed token, uint256 released, uint256 remaining);

    /// @dev M-01 fix: scale `totalBorrowedByAsset` per-token by `growthFactor`
    ///      so the per-asset borrow cap counter tracks accrued interest, not
    ///      just principal.
    function scaleTotal(
        address[] storage assetList,
        mapping(address => uint256) storage totalBorrowedByAsset,
        uint256 growthFactor
    ) external {
        uint256 n = assetList.length;
        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            uint256 byAsset = totalBorrowedByAsset[t];
            if (byAsset == 0) continue;
            totalBorrowedByAsset[t] = byAsset + (byAsset * growthFactor) / INDEX_DECIMALS;
        }
    }

    /// @dev M-01 fix: scale a user's per-asset attribution by the borrow-index
    ///      delta so the sum stays consistent with `positions[user].borrowed`.
    function scaleUser(
        address user,
        address[] storage assetList,
        mapping(address => mapping(address => uint256)) storage userBorrowByAsset,
        uint256 newIndex,
        uint256 oldSnap
    ) external {
        uint256 n = assetList.length;
        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            uint256 userAmt = userBorrowByAsset[user][t];
            if (userAmt == 0) continue;
            userBorrowByAsset[user][t] = (userAmt * newIndex) / oldSnap;
        }
    }

    /// @dev Distribute a repay/liquidation across the user's per-asset
    ///      attribution pro-rata. Each per-asset release is clamped to the
    ///      user's own attribution and the global counter.
    function releaseAssetBorrows(
        address user,
        uint256 repaidUsd,
        address[] storage assetList,
        mapping(address => uint256) storage totalBorrowedByAsset,
        mapping(address => mapping(address => uint256)) storage userBorrowByAsset
    ) external {
        uint256 n = assetList.length;
        if (n == 0) return;

        uint256 userTotal;
        for (uint256 i; i < n; ++i) {
            userTotal += userBorrowByAsset[user][assetList[i]];
        }
        if (userTotal == 0) return;

        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            uint256 userAmt = userBorrowByAsset[user][t];
            if (userAmt == 0) continue;
            uint256 release = (repaidUsd * userAmt) / userTotal;
            if (release > userAmt) release = userAmt;
            if (release > totalBorrowedByAsset[t]) release = totalBorrowedByAsset[t];
            userBorrowByAsset[user][t] -= release;
            totalBorrowedByAsset[t] -= release;
            emit BorrowCapReleased(t, release, totalBorrowedByAsset[t]);
        }
    }
}
