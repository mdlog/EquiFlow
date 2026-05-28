// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PythAdapterRegistry} from "../src/oracle/PythAdapterRegistry.sol";

/// @title T-4 fix tests — `PythAdapterRegistry`
/// @notice The registry enforces a single canonical PythPriceAdapter per
///         Pyth `priceId`. Deploy scripts consult the registry so multi-
///         vault deployments do not duplicate adapters or fragment keeper
///         load.
contract PythAdapterRegistryTest is Test {
    PythAdapterRegistry reg;
    address owner = address(0xA000);
    address registrar = address(0xA001);
    address adapter1 = address(0xC0FFEE);
    address adapter2 = address(0xDECAFE);

    bytes32 constant PRICE_ID_TSLA =
        0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1;

    function setUp() public {
        reg = new PythAdapterRegistry(owner);
    }

    function test_register_storesAdapterAndEmits() public {
        vm.expectEmit(true, true, true, true, address(reg));
        emit PythAdapterRegistry.AdapterRegistered(PRICE_ID_TSLA, adapter1);

        vm.prank(owner);
        reg.register(PRICE_ID_TSLA, adapter1);

        assertEq(reg.adapterOf(PRICE_ID_TSLA), adapter1);
    }

    function test_register_rejectsDuplicate() public {
        vm.prank(owner);
        reg.register(PRICE_ID_TSLA, adapter1);

        vm.prank(owner);
        vm.expectRevert(PythAdapterRegistry.AlreadyRegistered.selector);
        reg.register(PRICE_ID_TSLA, adapter2);

        assertEq(reg.adapterOf(PRICE_ID_TSLA), adapter1, "first write wins");
    }

    function test_register_rejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(PythAdapterRegistry.ZeroAddress.selector);
        reg.register(PRICE_ID_TSLA, address(0));
    }

    function test_register_onlyOwner() public {
        vm.prank(registrar);
        vm.expectRevert(); // Ownable: caller is not the owner
        reg.register(PRICE_ID_TSLA, adapter1);
    }

    function test_getAdapter_returnsZeroForUnregistered() public view {
        assertEq(reg.adapterOf(bytes32(uint256(0xDEAD))), address(0));
    }

    /// L-01 parity: registry is also Ownable2Step.
    function test_ownership_isTwoStep() public {
        address newOwner = address(0xBEEF);

        vm.prank(owner);
        reg.transferOwnership(newOwner);

        assertEq(reg.owner(), owner, "owner unchanged before accept");
        assertEq(reg.pendingOwner(), newOwner);

        vm.prank(newOwner);
        reg.acceptOwnership();

        assertEq(reg.owner(), newOwner);
        assertEq(reg.pendingOwner(), address(0));
    }
}
