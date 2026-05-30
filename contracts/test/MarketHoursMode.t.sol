// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EquiFlowVault} from "../src/EquiFlowVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {PythPriceAdapter} from "../src/oracle/PythPriceAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Tier-2 market-hours mode tests.
contract MarketHoursModeTest is Test {
    EquiFlowVault vault;
    MockUSDC usdc;
    MockStockToken tsla;
    MockPyth pyth;
    PythPriceAdapter tslaFeed;

    bytes32 constant TSLA_ID = bytes32(uint256(0x101));
    address owner = address(0xA000);
    address alice = address(0xA1);
    address bob = address(0xB0);

    uint8 constant OPEN = 0;
    uint8 constant CLOSED = 1;
    uint8 constant HALTED = 2;

    function setUp() public {
        vm.startPrank(owner);
        usdc = new MockUSDC();
        vault = new EquiFlowVault(IERC20(address(usdc)), 6, 0, 1_000, owner, owner); // rate 0
        tsla = new MockStockToken("Tesla", "TSLA");
        pyth = new MockPyth(1 hours, 0);
        tslaFeed = new PythPriceAdapter(IPyth(address(pyth)), TSLA_ID, "TSLA/USD", 348_51000000, 1 hours, owner);
        tslaFeed.setKeeper(owner, true);
        tslaFeed.setMaxDeviation(0);
        vault.listAsset(address(tsla), address(tslaFeed), 5500, 6500, 1 hours);
        _seed(348_51000000);

        usdc.mint(owner, 1_000_000e6);
        vault.announceDeposit(1_000_000e6);
        usdc.transfer(address(vault), 1_000_000e6);
        vault.register(1_000_000e6);
        vm.stopPrank();

        tsla.mint(alice, 1_000e18);
        usdc.mint(bob, 1_000_000e6);
        vm.prank(alice);
        tsla.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _craft(int256 px) internal view returns (bytes memory) {
        PythStructs.PriceFeed memory f = PythStructs.PriceFeed({
            id: TSLA_ID,
            price: PythStructs.Price({price: int64(px), conf: 0, expo: -8, publishTime: uint64(block.timestamp)}),
            emaPrice: PythStructs.Price({price: int64(px), conf: 0, expo: -8, publishTime: uint64(block.timestamp)})
        });
        return abi.encode(f);
    }

    function _seed(int256 px) internal {
        bytes[] memory d = new bytes[](1);
        d[0] = _craft(px);
        tslaFeed.updatePrice(d);
    }

    function _push(int256 px) internal {
        vm.warp(block.timestamp + 1);
        bytes[] memory d = new bytes[](1);
        d[0] = _craft(px);
        vm.prank(owner);
        tslaFeed.updatePrice(d);
    }

    // ─── access control ─────────────────────────────────────────────────────
    function test_mh_setMarketStatus_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setMarketStatus(address(tsla), CLOSED);

        vm.prank(owner);
        vault.setMarketStatus(address(tsla), CLOSED);
        assertEq(vault.marketStatus(address(tsla)), CLOSED);
    }

    // ─── borrow gate ────────────────────────────────────────────────────────
    function test_mh_borrowAllowedWhenOpen() public {
        // default status is OPEN (0)
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 10_000e18);
        (, uint256 borrowed, ) = vault.positionOf(alice);
        assertEq(borrowed, 10_000e18);
    }

    function test_mh_borrowBlockedWhenClosed() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 0); // pledge only

        vm.prank(owner);
        vault.setMarketStatus(address(tsla), CLOSED);

        vm.prank(alice);
        vm.expectRevert(EquiFlowVault.MarketClosed.selector);
        vault.pledgeAndBorrow(address(tsla), 0, 10_000e18); // borrow blocked
    }

    function test_mh_pledgeAllowedWhenClosed() public {
        vm.prank(owner);
        vault.setMarketStatus(address(tsla), CLOSED);
        // pledge-only (add collateral) must still work when closed
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 50e18, 0);
        assertEq(vault.collateral(alice, address(tsla)), 50e18);
    }

    // ─── liquidation gate ───────────────────────────────────────────────────
    function _makeUnhealthy() internal {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 19_000e18);
        _push(174_25500000); // crash -> unhealthy
        assertFalse(vault.isHealthy(alice));
    }

    function test_mh_liquidateBlockedWhenClosed() public {
        _makeUnhealthy();
        vm.prank(owner);
        vault.setMarketStatus(address(tsla), CLOSED);

        vm.prank(bob);
        vm.expectRevert(EquiFlowVault.MarketClosed.selector);
        vault.liquidate(alice, address(tsla), 5_000e18);
    }

    function test_mh_liquidateWorksWhenReopened() public {
        _makeUnhealthy();
        vm.startPrank(owner);
        vault.setMarketStatus(address(tsla), CLOSED);
        vault.setMarketStatus(address(tsla), OPEN); // keeper reopens (grace handled off-chain)
        vm.stopPrank();

        vm.prank(bob);
        vault.liquidate(alice, address(tsla), 5_000e18);
        (, uint256 borrowed, ) = vault.positionOf(alice);
        assertApproxEqAbs(borrowed, 14_000e18, 1e18);
    }
}
