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

/// @title Regression tests for the 2026-05 audit fix batch
/// @notice Covers the High finding (#1 bad-debt double-count) plus the
///         lower-severity / completeness-critic fixes batched for a single
///         redeploy. Self-contained setUp (borrow rate 0) so accounting
///         deltas are isolated from interest noise.
contract AuditBatchFixesTest is Test {
    EquiFlowVault vault;
    MockUSDC usdc;
    MockStockToken tsla;
    MockPyth pyth;
    PythPriceAdapter tslaFeed;

    bytes32 constant TSLA_PRICE_ID = bytes32(uint256(0x101));

    address owner = address(0xA000);
    address alice = address(0xA1);
    address bob = address(0xB0); // liquidator

    uint64 constant TSLA_LTV = 5500; // 55%
    uint64 constant TSLA_LIQ = 6500; // 65%
    uint64 constant STALE_AFTER = 1 hours;

    function setUp() public {
        vm.startPrank(owner);
        usdc = new MockUSDC();
        // borrow rate 0 -> no interest, no reserves: isolates write-off math.
        vault = new EquiFlowVault(IERC20(address(usdc)), 6, 0, 1_000, owner, owner);

        tsla = new MockStockToken("Tesla", "TSLA");
        pyth = new MockPyth(1 hours, 0);

        tslaFeed = new PythPriceAdapter(
            IPyth(address(pyth)),
            TSLA_PRICE_ID,
            "TSLA/USD",
            348_51000000, // $348.51 at 1e8
            1 hours,
            owner
        );
        tslaFeed.setKeeper(owner, true);
        tslaFeed.setMaxDeviation(0); // free-form pushes in tests

        vault.listAsset(address(tsla), address(tslaFeed), TSLA_LTV, TSLA_LIQ, STALE_AFTER);
        _seed(tslaFeed, TSLA_PRICE_ID, 348_51000000);

        // $1M USDC LP liquidity so the totalAssetsUsd clamp never floors to 0.
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

    // ─── Helpers ─────────────────────────────────────────────────────────
    function _craft(bytes32 priceId, int256 priceE8, uint64 conf, int32 expo)
        internal
        view
        returns (bytes memory)
    {
        PythStructs.PriceFeed memory feed = PythStructs.PriceFeed({
            id: priceId,
            price: PythStructs.Price({price: int64(priceE8), conf: conf, expo: expo, publishTime: block.timestamp}),
            emaPrice: PythStructs.Price({price: int64(priceE8), conf: conf, expo: expo, publishTime: block.timestamp})
        });
        return abi.encode(feed);
    }

    function _seed(PythPriceAdapter feed, bytes32 priceId, int256 priceE8) internal {
        bytes[] memory data = new bytes[](1);
        data[0] = _craft(priceId, priceE8, 0, -8);
        feed.updatePrice(data);
    }

    function _push(PythPriceAdapter feed, bytes32 priceId, int256 priceE8) internal {
        vm.warp(block.timestamp + 1);
        bytes[] memory data = new bytes[](1);
        data[0] = _craft(priceId, priceE8, 0, -8);
        vm.prank(owner);
        feed.updatePrice(data);
    }

    function _pushAt(PythPriceAdapter feed, bytes32 priceId, int256 priceE8, uint256 publishTime) internal {
        PythStructs.PriceFeed memory f = PythStructs.PriceFeed({
            id: priceId,
            price: PythStructs.Price({price: int64(priceE8), conf: 0, expo: -8, publishTime: uint64(publishTime)}),
            emaPrice: PythStructs.Price({price: int64(priceE8), conf: 0, expo: -8, publishTime: uint64(publishTime)})
        });
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encode(f);
        vm.prank(owner);
        feed.updatePrice(data);
    }

    function _pushConfExpo(PythPriceAdapter feed, bytes32 priceId, int256 priceRaw, uint64 conf, int32 expo)
        internal
    {
        vm.warp(block.timestamp + 1);
        bytes[] memory data = new bytes[](1);
        data[0] = _craft(priceId, priceRaw, conf, expo);
        vm.prank(owner);
        feed.updatePrice(data);
    }

    // ─── #3 [Low] _price must tolerate a future-dated publishTime ───────────
    function test_auditfix_l3_priceToleratesFutureTimestamp() public {
        // A publishTime 100s ahead of block.timestamp (clock skew / fast push),
        // within maxAge so the adapter accepts and caches it.
        _pushAt(tslaFeed, TSLA_PRICE_ID, 348_51000000, block.timestamp + 100);

        // pledgeAndBorrow exercises the strict _price() on the attribution
        // path. Pre-fix: block.timestamp - updatedAt underflow-reverts.
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 100e18);
        (, uint256 borrowed, ) = vault.positionOf(alice);
        assertEq(borrowed, 100e18, "borrow must succeed despite future-dated feed");
    }

    // ─── [Low] withdrawLp must not burn shares for a zero USDG payout ───────
    function test_auditfix_withdrawLpRejectsZeroPayout() public {
        // Owner is the sole real LP (~$1M). At ~par, 1 wei of shares converts
        // to <1e-6 USD, so _usdToUsdc floors the payout to 0. Pre-fix the
        // shares are burned for nothing; post-fix the call must revert.
        uint256 sharesBefore = vault.sharesOf(owner);
        assertGt(sharesBefore, 0, "owner is an LP");

        vm.prank(owner);
        vm.expectRevert(EquiFlowVault.AmountZero.selector);
        vault.withdrawLp(1);

        assertEq(vault.sharesOf(owner), sharesBefore, "no shares burned on zero payout");
    }

    // ─── [Low] setMaxConfidenceWidth must be bounded by a ceiling ───────────
    function test_auditfix_confWidthCeiling() public {
        uint64 ceiling = vault.MAX_CONF_WIDTH_BPS_CEILING();
        vm.startPrank(owner);
        // At the ceiling and disabling (0) remain allowed.
        vault.setMaxConfidenceWidth(address(tsla), ceiling);
        vault.setMaxConfidenceWidth(address(tsla), 0);
        // Above the ceiling the breaker cannot be loosened arbitrarily.
        vm.expectRevert(bytes("width>ceiling"));
        vault.setMaxConfidenceWidth(address(tsla), ceiling + 1);
        vm.stopPrank();
    }

    // ─── #2 [Low] confidence must be e8-normalized like price ───────────────
    function test_auditfix_l2_confidenceNormalizedToE8() public {
        // expo = -5: price 40_000_000 -> $400.00, conf 200_000 -> $2.00.
        // Both share the exponent, so confidence must be scaled to e8 exactly
        // like price; otherwise the vault's conf/price ratio is mis-scaled.
        _pushConfExpo(tslaFeed, TSLA_PRICE_ID, 40_000_000, 200_000, -5);

        (, int256 answer, , , ) = tslaFeed.latestRoundData();
        assertEq(answer, 400_00000000, "price normalized to e8");
        // Pre-fix confidence() returns the raw 200_000; post-fix the e8 value.
        assertEq(tslaFeed.confidence(), 2_00000000, "conf normalized to e8 (price scale)");
    }

    function _dataAt(bytes32 priceId, int256 priceE8, uint256 publishTime)
        internal
        pure
        returns (bytes[] memory data)
    {
        PythStructs.PriceFeed memory f = PythStructs.PriceFeed({
            id: priceId,
            price: PythStructs.Price({price: int64(priceE8), conf: 0, expo: -8, publishTime: uint64(publishTime)}),
            emaPrice: PythStructs.Price({price: int64(priceE8), conf: 0, expo: -8, publishTime: uint64(publishTime)})
        });
        data = new bytes[](1);
        data[0] = abi.encode(f);
    }

    // ─── [Medium] forceUpdatePrice override delay must be wall-clock, not ───
    //     the oracle publishTime (else it is bypassable via a backdated push)
    function test_auditfix_m_forceUpdateCannotBypassViaBackdatedPublishTime() public {
        bytes32 pid = bytes32(uint256(0xCAFE));
        // Fresh feed keeps the constructor's 5% deviation cap ACTIVE.
        PythPriceAdapter feed =
            new PythPriceAdapter(IPyth(address(pyth)), pid, "X/USD", 100_00000000, 1 hours, owner);
        vm.prank(owner);
        feed.setKeeper(owner, true);

        vm.warp(block.timestamp + 2 hours);

        // Attacker-keeper lands a within-cap normal update whose publishTime is
        // backdated 31min (> the 30min override delay) but within maxAge. The
        // real adapter write happens NOW.
        uint256 backdated = block.timestamp - 31 minutes;
        bytes[] memory within = _dataAt(pid, 102_00000000, backdated); // +2%, within 5% cap
        vm.prank(owner);
        feed.updatePrice(within);

        // Immediately force an off-market (+~96%) price. The override must be
        // refused because no real time has elapsed since the last write.
        bytes[] memory offMarket = _dataAt(pid, 200_00000000, block.timestamp);
        vm.prank(owner);
        vm.expectRevert(bytes("override too soon"));
        feed.forceUpdatePrice(offMarket);
    }

    // ─── [Low] global totalBorrowedUsd subtraction must be clamped ──────────
    //     (lazy per-user vs eager global index scaling can drift the global
    //      counter below a borrower's rolled debt → unclamped `-=` underflows
    //      and bricks repay/liquidate for the last borrower).
    uint256 constant TOTAL_BORROWED_SLOT = 6; // forge inspect storageLayout

    function test_auditfix_repayMaxClampsGlobalBorrowedDrift() public {
        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 100e18, 100e18);

        // Simulate worst-case drift: global counter sits 1 wei BELOW the
        // borrower's debt. Pre-fix repayMax's `totalBorrowedUsd -= d`
        // underflow-reverts; post-fix it floors to 0.
        uint256 g = vault.totalBorrowedUsd();
        vm.store(address(vault), bytes32(TOTAL_BORROWED_SLOT), bytes32(g - 1));

        vm.prank(alice);
        vault.repayMax(); // must not revert

        assertEq(vault.totalBorrowedUsd(), 0, "global borrowed floored, not underflowed");
        (, uint256 debtAfter, ) = vault.positionOf(alice);
        assertEq(debtAfter, 0, "borrower debt cleared");
    }

    // ─── #1 [High] bad-debt write-off must socialize the loss exactly once ──
    function test_auditfix_h1_writeOffSocializesLossExactlyOnce() public {
        // Alice pledges 1 TSLA (~$348.51) and borrows $100.
        vm.prank(alice);
        vault.pledgeAndBorrow(address(tsla), 1e18, 100e18);

        // TSLA crashes to $1; liquidator seizes all collateral.
        _push(tslaFeed, TSLA_PRICE_ID, 1_00000000);
        vm.prank(bob);
        vault.liquidate(alice, address(tsla), 100e18);
        assertEq(vault.collateral(alice, address(tsla)), 0, "collateral fully seized");

        // Schedule + clear the 24h timelock (rate 0 -> no interest accrues).
        vm.prank(owner);
        vault.scheduleWriteOffBadDebt(alice);
        vm.warp(block.timestamp + vault.OWNER_WITHDRAW_DELAY());

        // Measure the EXACT effect of executeWriteOffBadDebt.
        (, uint256 residualDebt, ) = vault.positionOf(alice);
        assertGt(residualDebt, 0, "expected residual bad debt");
        assertEq(vault.protocolReserves(), 0, "no reserves at rate 0");
        uint256 taBefore = vault.totalAssetsUsd();

        vm.prank(owner);
        vault.executeWriteOffBadDebt(alice);

        uint256 taAfter = vault.totalAssetsUsd();
        uint256 drop = taBefore - taAfter;

        // Value conservation: with zero reserves the LP backing must fall by
        // EXACTLY the written-off debt — not twice it. Pre-fix this is 2x.
        assertEq(drop, residualDebt, "LP backing must drop by exactly the bad debt (no double-count)");
    }
}
