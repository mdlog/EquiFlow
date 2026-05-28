// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KinkedRateModel} from "../src/interest/KinkedRateModel.sol";

contract KinkedRateModelTest is Test {
    KinkedRateModel irm;

    // Matches Deploy.s.sol production params (worst case 55% before vault
    // clamp). Pure-function tests so this constructor config is shared
    // across cases.
    uint256 constant BASE = 100;       // 1.00%
    uint256 constant SLOPE1 = 500;     // +5.00%
    uint256 constant SLOPE2 = 4900;    // +49.00%
    uint256 constant OPT = 8500;       // U_opt = 85%

    function setUp() public {
        irm = new KinkedRateModel("test", BASE, SLOPE1, SLOPE2, OPT);
    }

    // ─── Boundary values ────────────────────────────────────────────────

    function test_rateAtZero() public view {
        // U = 0% → base only
        assertEq(irm.getBorrowRate(0), BASE);
    }

    function test_rateAtOptimal() public view {
        // U = U_opt → base + slope1 fully accrued, slope2 not yet
        assertEq(irm.getBorrowRate(OPT), BASE + SLOPE1);
    }

    function test_rateJustBelowOptimal() public view {
        uint256 u = OPT - 1;
        uint256 expected = BASE + (u * SLOPE1) / OPT;
        assertEq(irm.getBorrowRate(u), expected);
    }

    function test_rateJustAboveOptimal() public view {
        uint256 u = OPT + 1;
        uint256 expected = BASE + SLOPE1 + (1 * SLOPE2) / (10_000 - OPT);
        assertEq(irm.getBorrowRate(u), expected);
    }

    function test_rateAt100Pct() public view {
        // U = 100% → base + slope1 + slope2 (full curve)
        assertEq(irm.getBorrowRate(10_000), BASE + SLOPE1 + SLOPE2);
    }

    function test_clampAboveBps() public view {
        // Pathological input — should behave as if U = 100%.
        uint256 atMax = irm.getBorrowRate(10_000);
        assertEq(irm.getBorrowRate(20_000), atMax);
        assertEq(irm.getBorrowRate(type(uint256).max), atMax);
    }

    // ─── Continuity at the kink ─────────────────────────────────────────
    // The two branches must produce the same value at U = U_opt (or differ
    // only by rounding). Otherwise borrowers would see a price gap as the
    // pool utilisation drifts across the kink.

    function test_continuityAtKink() public view {
        uint256 atKink = irm.getBorrowRate(OPT);
        uint256 lowBranch = irm.getBorrowRate(OPT - 1);
        uint256 highBranch = irm.getBorrowRate(OPT + 1);
        // low and atKink should be ≤ 1 bps apart
        assertApproxEqAbs(lowBranch, atKink, 1);
        // high - atKink should equal one step along slope2
        uint256 oneStepSlope2 = SLOPE2 / (10_000 - OPT);
        assertApproxEqAbs(highBranch - atKink, oneStepSlope2, 1);
    }

    // ─── Monotonicity (fuzz) ────────────────────────────────────────────

    function testFuzz_monotonic(uint256 u1, uint256 u2) public view {
        u1 = bound(u1, 0, 10_000);
        u2 = bound(u2, u1, 10_000); // u2 ≥ u1
        assertGe(irm.getBorrowRate(u2), irm.getBorrowRate(u1));
    }

    function testFuzz_neverExceedsTotalCap(uint256 u) public view {
        u = bound(u, 0, 10_000);
        // Constructor invariant: base + slope1 + slope2 ≤ BPS, so the rate
        // at U=100% (the maximum) is bounded by BPS.
        assertLe(irm.getBorrowRate(u), BASE + SLOPE1 + SLOPE2);
        assertLe(irm.getBorrowRate(u), 10_000);
    }

    // ─── Constructor validation ─────────────────────────────────────────

    function test_constructorRejectsOptimalZero() public {
        vm.expectRevert(KinkedRateModel.InvalidConfig.selector);
        new KinkedRateModel("bad", BASE, SLOPE1, SLOPE2, 0);
    }

    function test_constructorRejectsOptimalAtBps() public {
        vm.expectRevert(KinkedRateModel.InvalidConfig.selector);
        new KinkedRateModel("bad", BASE, SLOPE1, SLOPE2, 10_000);
    }

    function test_constructorRejectsSumAboveBps() public {
        vm.expectRevert(KinkedRateModel.InvalidConfig.selector);
        new KinkedRateModel("bad", 4000, 4000, 4001, 8000);
    }

    function test_constructorAcceptsSumExactlyBps() public {
        // Exactly 100% sum is valid (worst-case rate = 100%).
        KinkedRateModel max = new KinkedRateModel("max", 0, 5000, 5000, 8000);
        assertEq(max.getBorrowRate(10_000), 10_000);
    }

    // ─── Identity ────────────────────────────────────────────────────────

    function test_nameAndParamsExposed() public view {
        assertEq(irm.name(), "test");
        assertEq(irm.baseBps(), BASE);
        assertEq(irm.slope1Bps(), SLOPE1);
        assertEq(irm.slope2Bps(), SLOPE2);
        assertEq(irm.optimalUtilBps(), OPT);
    }
}
