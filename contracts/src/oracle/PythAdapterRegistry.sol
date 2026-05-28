// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title  PythAdapterRegistry
/// @notice T-4 fix (2026-05 pass 5): canonical directory mapping each Pyth
///         `priceId` to its single `PythPriceAdapter` address. Both the
///         USDG-vault deploy and the WETH-vault deploy must consult this
///         registry so they end up sharing one adapter per priceId. That
///         removes the "two adapters / one priceId" duplication confirmed
///         by the pass-4 deployment-artifact audit (5 adapters on RBN
///         chain 46630 that would become 10 once the WETH vault ships).
///
///         Sharing the adapter halves keeper push volume and eliminates
///         cross-vault liveness coupling — both vaults read the same fresh
///         price from the same source whenever the keeper pushes.
///
///         Entries are immutable per priceId (first registration wins).
///         To rotate a buggy adapter, deploy a new registry; the change is
///         observable on-chain and forces deploy-script awareness.
contract PythAdapterRegistry is Ownable2Step {
    /// @notice Canonical adapter address per Pyth `priceId`.
    mapping(bytes32 priceId => address adapter) public adapterOf;

    event AdapterRegistered(bytes32 indexed priceId, address indexed adapter);

    error AlreadyRegistered();
    error ZeroAddress();

    constructor(address _owner) Ownable(_owner) {}

    /// @notice Register the canonical adapter for a `priceId`. Owner-gated
    ///         so an attacker cannot squat popular feeds before deploy.
    /// @dev Reverts if the slot is already taken (immutability).
    function register(bytes32 priceId, address adapter) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        if (adapterOf[priceId] != address(0)) revert AlreadyRegistered();
        adapterOf[priceId] = adapter;
        emit AdapterRegistered(priceId, adapter);
    }
}
