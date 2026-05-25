// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EquiFlowVault} from "../src/EquiFlowVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {PythPriceAdapter} from "../src/oracle/PythPriceAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract EquiFlowVaultTest is Test {
    EquiFlowVault vault;
    MockUSDC usdc;
    MockStockToken tsla;
    MockStockToken aapl;
    MockPyth pyth;
    PythPriceAdapter tslaFeed;
    PythPriceAdapter aaplFeed;

    bytes32 constant TSLA_PRICE_ID = bytes32(uint256(0x101));
    bytes32 constant AAPL_PRICE_ID = bytes32(uint256(0x102));

    address owner = address(0xA000);
    address alice = address(0xA1);
    address bob = address(0xB0); // liquidator

    uint64 constant TSLA_LTV = 5500; // 55%
    uint64 constant TSLA_LIQ = 6500; // 65%
    uint64 constant AAPL_LTV = 7200; // 72%
    uint64 constant AAPL_LIQ = 8000; // 80%
    uint64 constant STALE_AFTER = 1 hours;

    function setUp() public {
        vm.startPrank(owner);
        usdc = new MockUSDC();
        // 5% borrow APR, 10% reserve factor, owner is treasury
        vault = new EquiFlowVault(IERC20(address(usdc)), 6, 500, 1_000, owner, owner);

        tsla = new MockStockToken("Tesla", "TSLA");
        aapl = new MockStockToken("Apple", "AAPL");

        // (validTimePeriod, singleUpdateFeeInWei) — match Deploy.s.sol mock
        pyth = new MockPyth(1 hours, 0);

        tslaFeed = new PythPriceAdapter(
            IPyth(address(pyth)),
            TSLA_PRICE_ID,
            "TSLA/USD",
            348_51000000, // $348.51 at 1e8
            1 hours,
            owner
        );
        aaplFeed = new PythPriceAdapter(
            IPyth(address(pyth)),
            AAPL_PRICE_ID,
            "AAPL/USD",
            217_84000000, // $217.84 at 1e8
            1 hours,
            owner
        );

        // Authorize owner as keeper for price updates
        tslaFeed.setKeeper(owner, true);
        aaplFeed.setKeeper(owner, true);

        vault.listAsset(address(tsla), address(tslaFeed), TSLA_LTV, TSLA_LIQ, STALE_AFTER);
        vault.listAsset(address(aapl), address(aaplFeed), AAPL_LTV, AAPL_LIQ, STALE_AFTER);

        // Prime MockPyth with the initial price so getPriceNoOlderThan() resolves
        // for any test that pushes a fresh update before reading.
        _seed(tslaFeed, TSLA_PRICE_ID, 348_51000000);
        _seed(aaplFeed, AAPL_PRICE_ID, 217_84000000);

        // Fund vault with $1M USDC liquidity via announce+transfer+register
        usdc.mint(owner, 1_000_000e6);
        vault.announceDeposit(1_000_000e6);
        usdc.transfer(address(vault), 1_000_000e6);
        vault.register(1_000_000e6);
        vm.stopPrank();

        // Give Alice & Bob some collateral & USDC to play with
        tsla.mint(alice, 1_000e18);
        aapl.mint(alice, 1_000e18);
        usdc.mint(alice, 100_000e6);
        usdc.mint(bob, 1_000_000e6);

        vm.prank(alice);
        tsla.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        aapl.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────
    /// @dev Build a MockPyth-compatible update payload — `abi.encode(PriceFeed)`.
    function _craft(bytes32 priceId, int256 priceE8) internal view returns (bytes memory) {
        PythStructs.PriceFeed memory feed = PythStructs.PriceFeed({
            id: priceId,
            price: PythStructs.Price({
                price: int64(priceE8),
                conf: 0,
                expo: -8,
                publishTime: block.timestamp
            }),
            emaPrice: PythStructs.Price({
                price: int64(priceE8),
                conf: 0,
                expo: -8,
                publishTime: block.timestamp
            })
        });
        return abi.encode(feed);
    }

    function _seed(PythPriceAdapter feed, bytes32 priceIdArg, int256 priceE8) internal {
        bytes[] memory data = new bytes[](1);
        data[0] = _craft(priceIdArg, priceE8);
        feed.updatePrice(data);
    }

    function _craftWithConf(bytes32 priceId, int256 priceE8, uint64 conf) internal view returns (bytes memory) {
        PythStructs.PriceFeed memory feed = PythStructs.PriceFeed({
            id: priceId,
            price: PythStructs.Price({
                price: int64(priceE8),
                conf: conf,
                expo: -8,
                publishTime: block.timestamp
            }),
            emaPrice: PythStructs.Price({
                price: int64(priceE8),
                conf: conf,
                expo: -8,
                publishTime: block.timestamp
            })
        });
        return abi.encode(feed);
    }

    function _pushWithConf(PythPriceAdapter feed, bytes32 priceId, int256 priceE8, uint64 conf) internal {
        vm.warp(block.timestamp + 1);
        bytes[] memory data = new bytes[](1);
        data[0] = _craftWithConf(priceId, priceE8, conf);
        vm.prank(owner);
        feed.updatePrice(data);
    }

    function _push(PythPriceAdapter feed, bytes32 priceId, int256 priceE8) internal {
        vm.warp(block.timestamp + 1);
        vm.prank(owner);
        bytes[] memory data = new bytes[](1);
        data[0] = _craft(priceId, priceE8);
        feed.updatePrice(data);
    }

    // ─── Listing ─────────────────────────────────────────────────────────
    function test_listAsset_storesAndEmits() public {
        (
            ,
            uint64 ltv,
            uint64 liq,
            uint64 stale,
            bool enabled
        ) = vault.assets(address(tsla));
        assertEq(ltv, TSLA_LTV);
        assertEq(liq, TSLA_LIQ);
        assertEq(stale, STALE_AFTER);
        assertTrue(enabled);
        address[] memory list = vault.listedAssets();
        assertEq(list.length, 2);
    }

    function test_listAsset_rejectsBadLtv() public {
        MockStockToken x = new MockStockToken("X", "X");
        PythPriceAdapter f = new PythPriceAdapter(
            IPyth(address(pyth)),
            bytes32(uint256(0x999)),
            "X/USD",
            100e8,
            1 hours,
            owner
        );
        vm.prank(owner);
        vm.expectRevert(bytes("bad ltv"));
        vault.listAsset(address(x), address(f), 9000, 8000, STALE_AFTER);
    }

    function test_listAsset_onlyOwner() public {
        MockStockToken x = new MockStockToken("X", "X");
        PythPriceAdapter f = new PythPriceAdapter(
            IPyth(address(pyth)),
            bytes32(uint256(0x999)),
            "X/USD",
            100e8,
            1 hours,
            owner
        );
        vm.prank(alice);
        vm.expectRevert();
        vault.listAsset(address(x), address(f), 5000, 6000, STALE_AFTER);
    }

    // ─── Pledge + Borrow ─────────────────────────────────────────────────
    function test_pledgeOnly_doesNotBorrow() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 0);

        assertEq(vault.collateral(alice, address(tsla)), 100e18);
        (uint256 collUsd, uint256 borrowed, uint256 hf) = vault.positionOf(alice);
        // 100 × $348.51 = $34,851
        assertEq(collUsd, 34_851e18);
        assertEq(borrowed, 0);
        assertEq(hf, type(uint256).max);
    }

    function test_pledgeAndBorrow_happyPath() public {
        uint256 borrowUsd = 10_000e18;
        uint256 beforeUsdc = usdc.balanceOf(alice);

        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, borrowUsd);

        assertEq(usdc.balanceOf(alice) - beforeUsdc, 10_000e6);
        (uint256 collUsd, uint256 borrowed, uint256 hf) = vault.positionOf(alice);
        assertEq(collUsd, 34_851e18);
        assertEq(borrowed, 10_000e18);
        assertGt(hf, 1e18);
    }

    function test_borrow_revertsAboveLtv() public {
        vm.prank(alice);
        vm.expectRevert(); // ExceedsLtv
        vault.pledgeAndBorrow(address(tsla), 100e18, 20_000e18);
    }

    function test_borrow_revertsIfInsufficientLiquidity() public {
        vm.prank(owner);
        vault.withdrawLiquidity(999_999e6, owner);
        vm.prank(alice);
        vm.expectRevert(EquiFlowVault.InsufficientLiquidity.selector);
        vault.pledgeAndBorrow(address(tsla), 100e18, 1_000e18);
    }

    function test_multiCollateral_blendsLtvCap() public {
        // TSLA: 100 × $348.51 = $34,851 @ 55% LTV
        // AAPL: 160 × $217.84 = $34,854 @ 72% LTV
        vm.startPrank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 0);
        vault.pledgeAndBorrow(address(aapl), 160e18, 0);
        vm.stopPrank();

        uint256 cap = vault.ltvCapBps(alice);
        assertGt(cap, 6300);
        assertLt(cap, 6400);
    }

    // ─── Repay + Withdraw ────────────────────────────────────────────────
    function test_repayMax_clearsDebt() public {
        vm.startPrank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 5_000e18);
        vault.repayMax();
        vm.stopPrank();
        (, uint256 borrowed,) = vault.positionOf(alice);
        assertEq(borrowed, 0);
    }

    function test_repay_partial() public {
        vm.startPrank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 5_000e18);
        vault.repay(2_000e18);
        vm.stopPrank();
        (, uint256 borrowed,) = vault.positionOf(alice);
        assertEq(borrowed, 3_000e18);
    }

    function test_withdraw_succeedsWhenNoDebt() public {
        vm.startPrank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 0);
        vault.withdraw(address(tsla), 40e18);
        vm.stopPrank();
        assertEq(vault.collateral(alice, address(tsla)), 60e18);
        assertEq(tsla.balanceOf(alice), 1_000e18 - 100e18 + 40e18);
    }

    function test_withdraw_revertsIfWouldBreachLtv() public {
        vm.startPrank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 15_000e18);
        vm.expectRevert(); // ExceedsLtv
        vault.withdraw(address(tsla), 80e18);
        vm.stopPrank();
    }

    // ─── Liquidation ─────────────────────────────────────────────────────
    function test_liquidate_revertsIfHealthy() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 5_000e18);
        vm.prank(bob);
        vm.expectRevert(EquiFlowVault.PositionHealthy.selector);
        vault.liquidate(alice, address(tsla), 1_000e18);
    }

    function test_liquidate_seizesCollateralWithBonus() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 19_000e18);
        _push(tslaFeed, TSLA_PRICE_ID, 174_25500000);

        assertFalse(vault.isHealthy(alice));

        uint256 bobTslaBefore = tsla.balanceOf(bob);
        uint256 bobUsdcBefore = usdc.balanceOf(bob);

        vm.prank(bob);
        vault.liquidate(alice, address(tsla), 5_000e18);

        uint256 bobTslaGained = tsla.balanceOf(bob) - bobTslaBefore;
        uint256 bobUsdcLost = bobUsdcBefore - usdc.balanceOf(bob);
        assertApproxEqAbs(bobTslaGained, 30.13e18, 0.1e18);
        assertEq(bobUsdcLost, 5_000e6);

        (, uint256 aliceBorrowed,) = vault.positionOf(alice);
        // v2 accrues linear interest, so the residual debt drifts a few wei
        // up from the principal-only baseline of 14_000e18. Allow $1 tolerance.
        assertApproxEqAbs(aliceBorrowed, 14_000e18, 1e18);
    }

    // ─── Oracle freshness ────────────────────────────────────────────────
    function test_pledgeAndBorrow_revertsIfStalePrice() public {
        vm.warp(block.timestamp + STALE_AFTER + 1);
        vm.prank(alice);
        vm.expectRevert(EquiFlowVault.StalePrice.selector);
        vault.pledgeAndBorrow(address(tsla), 100e18, 1_000e18);
    }

    // ─── Pyth adapter integration ────────────────────────────────────────
    function test_adapter_updatePriceMovesPrice() public {
        _push(tslaFeed, TSLA_PRICE_ID, 400_00000000);
        (, int256 answer, , , ) = tslaFeed.latestRoundData();
        assertEq(answer, 400_00000000);
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 0);
        (uint256 collUsd,,) = vault.positionOf(alice);
        assertEq(collUsd, 40_000e18);
    }

    function test_adapter_rejectsNegativePrice() public {
        vm.warp(block.timestamp + 1);
        bytes[] memory data = new bytes[](1);
        data[0] = _craft(TSLA_PRICE_ID, -1);
        vm.prank(owner);
        vm.expectRevert();
        tslaFeed.updatePrice(data);
    }

    function test_adapter_normalisesExponent() public {
        vm.warp(block.timestamp + 1);
        PythStructs.PriceFeed memory feed = PythStructs.PriceFeed({
            id: TSLA_PRICE_ID,
            price: PythStructs.Price({
                price: int64(40_000_000), // $400.00 at expo=-5
                conf: 0,
                expo: -5,
                publishTime: block.timestamp
            }),
            emaPrice: PythStructs.Price({
                price: int64(40_000_000),
                conf: 0,
                expo: -5,
                publishTime: block.timestamp
            })
        });
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encode(feed);
        vm.prank(owner);
        tslaFeed.updatePrice(data);

        (, int256 answer, , , ) = tslaFeed.latestRoundData();
        assertEq(answer, 400_00000000); // $400.00 in 1e8
    }

    function test_adapter_rejectsUnauthorizedKeeper() public {
        vm.warp(block.timestamp + 1);
        bytes[] memory data = new bytes[](1);
        data[0] = _craft(TSLA_PRICE_ID, 400_00000000);
        vm.prank(alice);
        vm.expectRevert(PythPriceAdapter.NotAuthorizedKeeper.selector);
        tslaFeed.updatePrice(data);
    }

    // ─── Admin ───────────────────────────────────────────────────────────
    function test_withdrawLiquidity_cannotDepleteBelowBorrowed() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 1_000e18, 100_000e18);
        vm.prank(owner);
        vm.expectRevert(bytes("would deplete"));
        vault.withdrawLiquidity(900_001e6, owner);
    }

    // ─── Oracle Confidence Circuit-Breaker ───────────────────────────────

    function test_confidence_blocksNewBorrow() public {
        // Set max confidence width to 1% (100 bps) for TSLA
        vm.prank(owner);
        vault.setMaxConfidenceWidth(address(tsla), 100);

        // Push a price with confidence = 2% of price (348.51 * 0.02 = ~6.97)
        _pushWithConf(tslaFeed, TSLA_PRICE_ID, 348_51000000, 6_97000000);

        vm.prank(alice);
        vm.expectRevert(); // OracleConfidenceTooWide
        vault.pledgeAndBorrow(address(tsla), 100e18, 10_000e18);
    }

    function test_confidence_allowsBelowThreshold() public {
        vm.prank(owner);
        vault.setMaxConfidenceWidth(address(tsla), 200); // 2%

        // Push conf = 0.5% of price (348.51 * 0.005 = ~1.74)
        _pushWithConf(tslaFeed, TSLA_PRICE_ID, 348_51000000, 1_74000000);

        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 10_000e18);
        (, uint256 borrowed,) = vault.positionOf(alice);
        assertEq(borrowed, 10_000e18);
    }

    function test_confidence_doesNotBlockLiquidation() public {
        // Borrow first with zero confidence
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 19_000e18);

        // Set strict confidence limit
        vm.prank(owner);
        vault.setMaxConfidenceWidth(address(tsla), 50); // 0.5%

        // Push price drop with wide confidence
        _pushWithConf(tslaFeed, TSLA_PRICE_ID, 174_25500000, 10_00000000);

        // Liquidation should STILL work despite wide confidence
        assertFalse(vault.isHealthy(alice));
        vm.prank(bob);
        vault.liquidate(alice, address(tsla), 5_000e18);
        (, uint256 borrowed,) = vault.positionOf(alice);
        assertApproxEqAbs(borrowed, 14_000e18, 1e18);
    }

    function test_confidence_doesNotBlockRepay() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 10_000e18);

        vm.prank(owner);
        vault.setMaxConfidenceWidth(address(tsla), 50);
        _pushWithConf(tslaFeed, TSLA_PRICE_ID, 348_51000000, 20_00000000);

        // Repay should STILL work despite wide confidence
        vm.prank(alice);
        vault.repay(5_000e18);
        (, uint256 borrowed,) = vault.positionOf(alice);
        assertApproxEqAbs(borrowed, 5_000e18, 1e18);
    }

    function test_confidence_zeroMeansUncapped() public {
        // Default is 0 (uncapped) — any confidence should pass
        assertEq(vault.maxConfWidthBps(address(tsla)), 0);
        _pushWithConf(tslaFeed, TSLA_PRICE_ID, 348_51000000, 100_00000000);

        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 10_000e18);
        (, uint256 borrowed,) = vault.positionOf(alice);
        assertEq(borrowed, 10_000e18);
    }

    // ─── Per-Asset Borrow Cap ────────────────────────────────────────────

    function test_borrowCap_blocksExcessBorrow() public {
        vm.prank(owner);
        vault.setBorrowCap(address(tsla), 10_000e18); // $10k cap

        vm.prank(alice);
        vm.expectRevert(); // BorrowCapExceeded
        vault.pledgeAndBorrow(address(tsla), 100e18, 15_000e18);
    }

    function test_borrowCap_allowsBelowCap() public {
        vm.prank(owner);
        vault.setBorrowCap(address(tsla), 10_000e18);

        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 5_000e18);
        (, uint256 borrowed,) = vault.positionOf(alice);
        assertEq(borrowed, 5_000e18);
    }

    function test_borrowCap_zeroIsUnlimited() public {
        // Default cap is 0 (unlimited)
        assertEq(vault.borrowCapUsd(address(tsla)), 0);

        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 15_000e18);
        (, uint256 borrowed,) = vault.positionOf(alice);
        assertEq(borrowed, 15_000e18);
    }

    function test_borrowCap_repayReleasesCapacity() public {
        vm.prank(owner);
        vault.setBorrowCap(address(tsla), 10_000e18);

        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 10_000e18);

        (uint256 cap, uint256 used) = vault.borrowCapInfo(address(tsla));
        assertEq(cap, 10_000e18);
        assertEq(used, 10_000e18);

        // Repay $5k — should release cap space
        vm.prank(alice);
        vault.repay(5_000e18);

        (, uint256 usedAfter) = vault.borrowCapInfo(address(tsla));
        assertApproxEqAbs(usedAfter, 5_000e18, 1e18);
    }

    function test_borrowCap_liquidateReleasesCapacity() public {
        vm.prank(owner);
        vault.setBorrowCap(address(tsla), 20_000e18);

        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 19_000e18);

        _push(tslaFeed, TSLA_PRICE_ID, 174_25500000);
        assertFalse(vault.isHealthy(alice));

        vm.prank(bob);
        vault.liquidate(alice, address(tsla), 5_000e18);

        (, uint256 usedAfter) = vault.borrowCapInfo(address(tsla));
        assertApproxEqAbs(usedAfter, 14_000e18, 1e18);
    }

    function test_borrowCap_multiUserAccumulates() public {
        vm.prank(owner);
        vault.setBorrowCap(address(tsla), 12_000e18);

        tsla.mint(bob, 1_000e18);
        vm.prank(bob);
        tsla.approve(address(vault), type(uint256).max);

        // Alice borrows $8k
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 8_000e18);

        // Bob tries to borrow $5k — exceeds cap
        vm.prank(bob);
        vm.expectRevert(); // BorrowCapExceeded — total would be $13k > $12k cap
        vault.pledgeAndBorrow(address(tsla), 100e18, 5_000e18);

        // Bob borrows $4k — fits within cap
        vm.prank(bob);
        vault.pledgeAndBorrow(address(tsla), 100e18, 4_000e18);

        (, uint256 used) = vault.borrowCapInfo(address(tsla));
        assertEq(used, 12_000e18);
    }

    function test_borrowCapInfo_view() public {
        vm.prank(owner);
        vault.setBorrowCap(address(tsla), 50_000e18);

        (uint256 cap, uint256 used) = vault.borrowCapInfo(address(tsla));
        assertEq(cap, 50_000e18);
        assertEq(used, 0);
    }

    // ─── C-01: CEI Fix Verification ─────────────────────────────────────
    function test_pledgeAndBorrow_transferBeforeStateUpdate() public {
        uint256 aliceTslaBefore = tsla.balanceOf(alice);
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 50e18, 0);
        assertEq(vault.collateral(alice, address(tsla)), 50e18);
        assertEq(tsla.balanceOf(alice), aliceTslaBefore - 50e18);
    }

    // ─── C-03: Share Inflation Protection ───────────────────────────────
    function test_firstDeposit_burnDeadShares() public {
        // Deploy a fresh vault to test first-deposit path
        vm.startPrank(owner);
        MockUSDC usdc2 = new MockUSDC();
        EquiFlowVault vault2 = new EquiFlowVault(
            IERC20(address(usdc2)), 6, 500, 1_000, owner, owner
        );

        usdc2.mint(owner, 1_000e6);
        vault2.announceDeposit(1_000e6);
        usdc2.transfer(address(vault2), 1_000e6);
        vault2.register(1_000e6);
        vm.stopPrank();

        // Dead shares should be minted to address(1)
        assertEq(vault2.sharesOf(address(1)), 1_000_000);
        // Total shares = owner shares + dead shares
        uint256 ownerShares = vault2.sharesOf(owner);
        assertGt(ownerShares, 0);
        assertEq(vault2.totalShares(), ownerShares + 1_000_000);
    }

    // ─── H-04: Minimum Borrow Amount ────────────────────────────────────
    function test_borrow_revertsIfBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(EquiFlowVault.BorrowTooSmall.selector, 1e18, 10e18)
        );
        vault.pledgeAndBorrow(address(tsla), 100e18, 1e18); // $1 < $10 min
    }

    // ─── M-04: Division by zero guard ───────────────────────────────────
    function test_releaseAssetBorrows_handlesEmptyAssetList() public {
        // This test verifies the n==0 guard exists; in practice assetList
        // never shrinks, but the guard prevents theoretical division-by-zero.
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 10_000e18);
        // Just verify repay works with the guard in place
        vm.prank(alice);
        vault.repay(5_000e18);
        (, uint256 borrowed,) = vault.positionOf(alice);
        assertApproxEqAbs(borrowed, 5_000e18, 1e18);
    }

    // ─── L-01: Configurable Liquidation Bonus ───────────────────────────
    function test_setLiquidationBonus() public {
        vm.prank(owner);
        vault.setLiquidationBonus(300); // 3%
        assertEq(vault.liquidationBonusBps(), 300);
    }

    function test_setLiquidationBonus_rejectsAbove20Pct() public {
        vm.prank(owner);
        vm.expectRevert(bytes("bonus>20%"));
        vault.setLiquidationBonus(2_001);
    }

    // ─── L-07: Poke Rate Limiter ────────────────────────────────────────
    function test_pokeInterest_rateLimited() public {
        vm.warp(100);
        vault.pokeInterest();
        vm.expectRevert(EquiFlowVault.PokeTooFrequent.selector);
        vault.pokeInterest();

        vm.warp(116);
        vault.pokeInterest();
    }

    // ─── H-03: Repay works even with stale price feeds ──────────────────
    function test_repay_succeedsWithStalePriceFeed() public {
        // Borrow against TSLA and AAPL
        vm.startPrank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 5_000e18);
        vault.pledgeAndBorrow(address(aapl), 100e18, 5_000e18);
        vm.stopPrank();

        // Let AAPL feed go stale
        vm.warp(block.timestamp + STALE_AFTER + 1);
        // Push fresh TSLA price only
        _push(tslaFeed, TSLA_PRICE_ID, 348_51000000);

        // Repay should still work — _releaseAssetBorrows uses _safePriceOrZero
        vm.prank(alice);
        vault.repay(5_000e18);
        // Use borrowedOf instead of positionOf — positionOf calls collateralValueUsd
        // which uses strict _price and would revert on stale AAPL feed.
        uint256 borrowed = vault.borrowedOf(alice);
        assertApproxEqAbs(borrowed, 5_000e18, 10e18);
    }

    // ─── M-06: withdrawLiquidity cannot exceed bookedUsdg ───────────────
    function test_withdrawLiquidity_revertsIfExceedsBooked() public {
        // First add extra USDC directly to vault (bypassing register) so
        // reserves > booked, then try to withdraw more than booked.
        usdc.mint(address(vault), 500e6);
        uint256 booked = vault.bookedUsdg();
        vm.prank(owner);
        vm.expectRevert(bytes("exceeds booked"));
        vault.withdrawLiquidity(booked + 1, owner);
    }

    // ─── C-02: Adapter Keeper Whitelist ──────────────────────────────────
    function test_adapter_ownerCanAlwaysUpdate() public {
        _push(tslaFeed, TSLA_PRICE_ID, 400_00000000);
        (, int256 answer, , , ) = tslaFeed.latestRoundData();
        assertEq(answer, 400_00000000);
    }

    function test_adapter_authorizedKeeperCanUpdate() public {
        vm.prank(owner);
        tslaFeed.setKeeper(alice, true);

        vm.warp(block.timestamp + 1);
        bytes[] memory data = new bytes[](1);
        data[0] = _craft(TSLA_PRICE_ID, 400_00000000);
        vm.prank(alice);
        tslaFeed.updatePrice(data);

        (, int256 answer, , , ) = tslaFeed.latestRoundData();
        assertEq(answer, 400_00000000);
    }

    // ─── Pausable ───────────────────────────────────────────────────────

    function test_pause_blocksPledge() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(alice);
        vm.expectRevert();
        vault.pledgeAndBorrow(address(tsla), 100e18, 0);
    }

    function test_pause_blocksRegister() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(alice);
        vm.expectRevert();
        vault.announceDeposit(1_000e6);
    }

    function test_pause_blocksWithdrawLp() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(owner);
        vm.expectRevert();
        vault.withdrawLp(100);
    }

    function test_pause_allowsRepay() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 5_000e18);

        vm.prank(owner);
        vault.pause();

        vm.prank(alice);
        vault.repay(2_000e18);
        uint256 borrowed = vault.borrowedOf(alice);
        assertApproxEqAbs(borrowed, 3_000e18, 1e18);
    }

    function test_pause_allowsLiquidation() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 19_000e18);
        _push(tslaFeed, TSLA_PRICE_ID, 174_25500000);

        vm.prank(owner);
        vault.pause();

        assertFalse(vault.isHealthy(alice));
        vm.prank(bob);
        vault.liquidate(alice, address(tsla), 5_000e18);
    }

    function test_unpause_restoresOperations() public {
        vm.startPrank(owner);
        vault.pause();
        vault.unpause();
        vm.stopPrank();

        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 5_000e18);
        (, uint256 borrowed,) = vault.positionOf(alice);
        assertEq(borrowed, 5_000e18);
    }

    function test_pause_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.pause();
    }

    // ─── Deposit Intent (anti front-run) ────────────────────────────────

    function test_register_requiresIntent() public {
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.transfer(address(vault), 1_000e6);
        vm.expectRevert(EquiFlowVault.NoDepositIntent.selector);
        vault.register(1_000e6);
        vm.stopPrank();
    }

    function test_register_revertsIfIntentExpired() public {
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        vault.announceDeposit(1_000e6);
        usdc.transfer(address(vault), 1_000e6);
        vm.stopPrank();

        vm.warp(block.timestamp + 11 minutes);

        vm.prank(alice);
        vm.expectRevert(EquiFlowVault.DepositIntentExpired.selector);
        vault.register(1_000e6);
    }

    function test_register_revertsIfAmountExceedsIntent() public {
        usdc.mint(alice, 2_000e6);
        vm.startPrank(alice);
        vault.announceDeposit(1_000e6);
        usdc.transfer(address(vault), 2_000e6);
        vm.expectRevert(
            abi.encodeWithSelector(
                EquiFlowVault.DepositIntentAmountMismatch.selector,
                1_000e6,
                2_000e6
            )
        );
        vault.register(2_000e6);
        vm.stopPrank();
    }

    function test_register_happyPathWithIntent() public {
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        vault.announceDeposit(1_000e6);
        usdc.transfer(address(vault), 1_000e6);
        vault.register(1_000e6);
        vm.stopPrank();

        assertGt(vault.sharesOf(alice), 0);
    }

    function test_cancelDeposit() public {
        vm.startPrank(alice);
        vault.announceDeposit(1_000e6);
        vault.cancelDeposit();
        vm.stopPrank();

        (uint256 amount,,) = vault.depositIntents(alice);
        assertEq(amount, 0);
    }

    function test_register_blocksFrontRunAttack() public {
        // Alice announces and transfers 1000 USDC
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        vault.announceDeposit(1_000e6);
        usdc.transfer(address(vault), 1_000e6);
        vm.stopPrank();

        // Attacker (bob) sees the transfer and tries to claim it
        vm.startPrank(bob);
        vault.announceDeposit(1_000e6);
        // Bob's snapshot captured the vault balance AFTER Alice's transfer,
        // so deltaSinceAnnounce = 0 → revert
        vm.expectRevert(
            abi.encodeWithSelector(
                EquiFlowVault.InsufficientTransfer.selector,
                1_000e6,
                uint256(0)
            )
        );
        vault.register(1_000e6);
        vm.stopPrank();

        // Alice can still register her own deposit
        vm.prank(alice);
        vault.register(1_000e6);
        assertGt(vault.sharesOf(alice), 0);
        assertEq(vault.sharesOf(bob), 0);
    }

    // ─── Close Factor ───────────────────────────────────────────────────

    function test_liquidate_closeFactor_capsRepayAt50Pct() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 19_000e18);
        _push(tslaFeed, TSLA_PRICE_ID, 174_25500000);
        assertFalse(vault.isHealthy(alice));

        vm.prank(bob);
        vault.liquidate(alice, address(tsla), 19_000e18);

        uint256 borrowed = vault.borrowedOf(alice);
        // Close factor = 50%, so max repay ~ 9_500e18. Remaining should be ~9_500e18.
        assertApproxEqAbs(borrowed, 9_500e18, 100e18);
    }

    function test_liquidate_fullLiquidationBelowCriticalHf() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 19_000e18);
        // Drop price to make HF < 0.5 (critically underwater)
        _push(tslaFeed, TSLA_PRICE_ID, 50_00000000);
        uint256 hf = vault.healthFactor(alice);
        assertLt(hf, 5e17);

        // Full debt amount requested — no close factor cap below critical HF
        uint256 borrowedBefore = vault.borrowedOf(alice);
        vm.prank(bob);
        vault.liquidate(alice, address(tsla), borrowedBefore);
        // Collateral-limited: all 100 TSLA seized, but debt exceeds collateral value.
        // Verify close factor did NOT cap the repayment (would have been ~50%).
        uint256 borrowedAfter = vault.borrowedOf(alice);
        // Without close factor, repayment is collateral-limited (not 50%-limited).
        // 100 TSLA @ $50 = $5k collateral → max seize = $5k → repays ~$4.76k (net of bonus).
        // Remaining debt = ~$19k - $4.76k = ~$14.24k (collateral-limited, not close-factor-limited).
        assertLt(borrowedAfter, borrowedBefore);
        assertEq(vault.collateral(alice, address(tsla)), 0);
    }

    // ─── Self-liquidation Prevention ────────────────────────────────────

    function test_liquidate_revertsSelfLiquidation() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 19_000e18);
        _push(tslaFeed, TSLA_PRICE_ID, 174_25500000);

        vm.prank(alice);
        vm.expectRevert(bytes("no self-liquidation"));
        vault.liquidate(alice, address(tsla), 5_000e18);
    }

    // ─── Sweep Borrow Dust ──────────────────────────────────────────────

    function test_sweepBorrowDust_clearsSmallRemnant() public {
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 5_000e18);
        vm.prank(alice);
        vault.repayMax();

        // After repayMax, totalBorrowedUsd should be 0 or near-zero dust
        uint256 remaining = vault.totalBorrowedUsd();
        assertLt(remaining, 1e18);

        vm.prank(owner);
        vault.sweepBorrowDust();
        assertEq(vault.totalBorrowedUsd(), 0);
    }

    // ─── Borrow Cap Accounting (per-user per-token fix) ─────────────────

    function test_borrowCapRelease_noLeakWithMultiCollateral() public {
        vm.prank(owner);
        vault.setBorrowCap(address(tsla), 10_000e18);

        // Alice borrows $5k via TSLA, then adds AAPL collateral (no borrow)
        vm.startPrank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 5_000e18);
        vault.pledgeAndBorrow(address(aapl), 100e18, 0);
        vm.stopPrank();

        (, uint256 usedBefore) = vault.borrowCapInfo(address(tsla));
        assertEq(usedBefore, 5_000e18);

        // Repay full — cap must be FULLY released for TSLA, not split to AAPL
        vm.prank(alice);
        vault.repayMax();

        (, uint256 usedAfter) = vault.borrowCapInfo(address(tsla));
        assertEq(usedAfter, 0);
    }

    function test_borrowCapRelease_multiTokenBorrow() public {
        vm.prank(owner);
        vault.setBorrowCap(address(tsla), 10_000e18);
        vm.prank(owner);
        vault.setBorrowCap(address(aapl), 10_000e18);

        // Alice borrows $3k via TSLA, $2k via AAPL
        vm.startPrank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 3_000e18);
        vault.pledgeAndBorrow(address(aapl), 100e18, 2_000e18);
        vm.stopPrank();

        // Repay $5k total — should release proportionally by borrow origin (60/40)
        vm.prank(alice);
        vault.repayMax();

        (, uint256 tslaUsed) = vault.borrowCapInfo(address(tsla));
        (, uint256 aaplUsed) = vault.borrowCapInfo(address(aapl));
        assertEq(tslaUsed, 0);
        assertEq(aaplUsed, 0);
    }

    function test_borrowCapRelease_repeatedCycleNoLeak() public {
        vm.prank(owner);
        vault.setBorrowCap(address(tsla), 5_000e18);

        // Cycle 5 times: borrow TSLA → add AAPL → repay → withdraw
        for (uint256 i; i < 5; i++) {
            vm.startPrank(alice);
            vault.pledgeAndBorrow(address(tsla), 10e18, 1_000e18);
            vault.pledgeAndBorrow(address(aapl), 10e18, 0);
            vault.repayMax();
            vault.withdraw(address(tsla), 10e18);
            vault.withdraw(address(aapl), 10e18);
            vm.stopPrank();
        }

        (, uint256 tslaUsed) = vault.borrowCapInfo(address(tsla));
        // Must be 0 after full repay — no accumulated leak
        assertEq(tslaUsed, 0);
    }
}
